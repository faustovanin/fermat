"""Join capture records by explicit identity mapping; never infer fraud from failed status."""
import json
import sys
from collections import Counter
from pathlib import Path


def evaluate(bundle, worker):
    truth=json.loads((bundle/'ground_truth.json').read_text())
    mapping=json.loads((worker/'mapping.json').read_text())
    if mapping['datasetSha256']!=truth['events_sha256']:
        raise ValueError('Dataset hash differs from ground truth')
    reference={r['eventID']:r for r in map(json.loads,(bundle/'local-reference.jsonl').read_text().splitlines())}
    ids={r['originalEventID']:r['submittedEventID'] for r in mapping['events']}
    expected={eid for row in truth['records'] for eid in row['history_event_ids']}
    if len(ids)!=len(mapping['events']) or set(ids)!=expected:
        raise ValueError('Mapping does not cover unique ground-truth histories')
    records=[json.loads(line) for line in (worker/'submissions.jsonl').read_text().splitlines()]
    outcomes={};halting=[]
    for row in records:
        key=row['originalEventID']
        if key not in ids or row['submittedEventID']!=ids[key]:raise ValueError('Unmatched capture ID')
        if row.get('halted'):
            halting.append(row);continue
        if key in outcomes:raise ValueError('Duplicate outcome record')
        outcomes[key]=row
    mismatches=[]
    for eid,row in outcomes.items():
        ref=reference.get(eid)
        accepted=row.get('outcome')=='accepted'
        if ref is None or ref['accepted']!=accepted:
            mismatches.append(eid)
        elif not accepted and (not ref['rules'] or ref['rules'][0]['errorCode'] not in row.get('ruleCodes',[])):
            mismatches.append(eid)
    missing=sorted(expected-set(outcomes))
    counts=Counter(r.get('outcome','unknown_failure') for r in outcomes.values())
    infrastructure=sum(count for kind,count in counts.items() if kind not in ('accepted','rule_rejection','structural_rejection'))
    targets=matched=negative_alerts=0
    for row in truth['records']:
        for target in row['target_event_ids']:
            targets+=1
            actual=outcomes.get(target,{})
            matched+=actual.get('outcome')=='rule_rejection' and row['expected_rule_code'] in actual.get('ruleCodes',[])
        if not row.get('diversion_anomaly',row['injected']):
            negative_alerts+=sum(outcomes.get(eid,{}).get('outcome') in ('rule_rejection','structural_rejection') for eid in row['history_event_ids'])
    result={'expected_events':len(expected),'recorded_events':len(outcomes),'missing_events':missing,
        'outcomes':dict(counts),'targets':targets,'expected_target_matches':matched,
        'negative_control_alerts':negative_alerts,'halting_records':len(halting),
        'reference_mismatches':mismatches,
        'evaluable':not missing and not infrastructure and not halting,
        'passed':not missing and not mismatches and not infrastructure and not halting and matched==targets and not negative_alerts,
        'scope':'Connector evidence only. Infrastructure and unexplained failures are not rule detections.'}
    (worker/'evaluation.json').write_text(json.dumps(result,indent=2))
    return result


if __name__=='__main__':
    result=evaluate(Path(sys.argv[1]),Path(sys.argv[2]));print(json.dumps(result,indent=2));sys.exit(0 if result['passed'] else 1)
