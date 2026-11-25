"""Audit timed EU-US captures; keep simulated timing out of performance results."""
import argparse
import hashlib
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import statistics
from evaluate_caliper_capture import evaluate


def normalize(value,suffix):
    if isinstance(value,str):return value[:-len(suffix)] if value.endswith(suffix) else value
    if isinstance(value,list):return [normalize(v,suffix) for v in value]
    if isinstance(value,dict):return {k:normalize(v,suffix) for k,v in value.items()}
    return value


def percentile(values,p):
    values=sorted(values);rank=(len(values)-1)*p;lo=int(rank);hi=min(lo+1,len(values)-1)
    return values[lo]+(values[hi]-values[lo])*(rank-lo)


def durations(rows):
    values=[r['serviceMs'] for r in rows if isinstance(r.get('serviceMs'),(float,int))]
    return {'n':len(values),'median_ms':statistics.median(values) if values else None,
            'p95_ms':percentile(values,.95) if len(values)>=20 else None,
            'p99_ms':percentile(values,.99) if len(values)>=100 else None,
            'mean_queue_ms':statistics.mean(r['queueWaitMs'] for r in rows) if values else None}


def write_csv(file,rows):
    rows=list(rows)
    if not rows:return
    with file.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)


def analyze(bundle,simulated=False,worker=None):
    worker=worker or bundle/'capture/worker'
    base=evaluate(bundle,worker)
    outcomes=[r for r in map(json.loads,(worker/'submissions.jsonl').read_text().splitlines()) if not r.get('halted')]
    lookup={r['originalEventID']:r for r in outcomes}
    truth=json.loads((bundle/'ground_truth.json').read_text())
    if hashlib.sha256((bundle/'events.json').read_bytes()).hexdigest()!=truth['events_sha256']:raise ValueError('Actual dataset hash differs from ground truth')
    metadata={r['eventID']:r for r in map(json.loads,(bundle/'event-metadata.jsonl').read_text().splitlines())}
    events={e['eventID']:e for e in json.loads((bundle/'events.json').read_text())['epcisBody']['eventList']}
    mapping=json.loads((worker/'mapping.json').read_text());suffix='#test-run='+mapping['runId']
    state=json.loads((bundle/'local-product-state.json').read_text())
    issues=[];audits=[]
    if (worker/'ledger-audit.jsonl').exists():audits=list(map(json.loads,(worker/'ledger-audit.jsonl').read_text().splitlines()))
    audited_events=set();audited_products=set()
    for r in audits:
        if r['kind']=='event':
            eid=r['originalEventID']
            if eid in audited_events:issues.append('Duplicate event audit: '+eid)
            audited_events.add(eid)
            expected=eid in lookup and lookup[eid]['outcome']=='accepted'
            if r['exists']!=expected:issues.append('Event presence: '+eid)
            if expected:
                stored=normalize(r['stored'],suffix);original={**events[eid],'counterfeitScore':0,'isValid':True}
                if stored!=original:issues.append('Stored event/score differs: '+eid)
        elif r['kind']=='product':
            epc=normalize(r['epc'],suffix);audited_products.add(epc)
            if state.get('product_state_'+epc)!=normalize(r['state'],suffix):issues.append('Product state differs: '+epc)
    expected_products={epc for r in truth['records'] for epc in r['history_epcs']}
    if audited_events!=set(events):issues.append('Incomplete event audit')
    if audited_products!=expected_products:issues.append('Incomplete product-state audit')
    timing_errors=[]
    for r in outcomes:
        if r.get('schemaVersion')!=2 or r['originalEventID'] not in metadata:timing_errors.append(r['originalEventID']);continue
        try:
            a,s,e=map(int,(r['admittedMonotonicNs'],r['requestStartMonotonicNs'],r['responseEndMonotonicNs']))
            if not a<=s<=e or abs((e-s)/1e6-r['serviceMs'])>1e-6:timing_errors.append(r['originalEventID'])
        except (ValueError,KeyError):timing_errors.append(r['originalEventID'])
    product=defaultdict(Counter);histories=[];targets=defaultdict(Counter)
    for label in truth['records']:
        code=label['drug_code'];p=product[code];p['planned_histories']+=1
        p['planned_positive']+=label['diversion_anomaly']
        seen=[lookup[eid] for eid in label['history_event_ids'] if eid in lookup]
        p['observed_events']+=len(seen)
        complete=len(seen)==len(label['history_event_ids'])
        p['complete_histories']+=complete
        category='untested' if not seen else 'partial'
        if complete:
            known=all(r['outcome'] in ('accepted','rule_rejection','structural_rejection') for r in seen)
            alarm=any(r['outcome'] in ('rule_rejection','structural_rejection') for r in seen)
            category=(('tp' if alarm else 'fn') if label['diversion_anomaly'] else ('fp' if alarm else 'tn')) if known else 'unknown'
            p[category]+=1
        histories.append({'transaction_id':label['transaction_id'],'drug_code':code,'category':category,'observed_events':len(seen)})
        for eid in label['target_event_ids']:
            t=targets[label['anomaly_type']];t['planned']+=1
            if eid not in lookup:t['untested']+=1
            elif lookup[eid]['outcome']=='rule_rejection' and label['expected_rule_code'] in lookup[eid]['ruleCodes']:t['detected']+=1
            else:t['observed_not_detected']+=1
    output=bundle/('simulated-analysis' if simulated else 'analysis');output.mkdir(exist_ok=True)
    columns=['planned_histories','planned_positive','observed_events','complete_histories','tp','fp','tn','fn','unknown']
    write_csv(output/'products.csv',({'drug_code':code,**{k:p[k] for k in columns}} for code,p in sorted(product.items())))
    write_csv(output/'histories.csv',histories)
    write_csv(output/'targets.csv',({'mechanism':k,**{field:v[field] for field in ('planned','detected','observed_not_detected','untested')}} for k,v in sorted(targets.items())))
    performance=[];groups=defaultdict(list)
    for r in outcomes:
        for dimension,key in [('all','all'),('drug_code',metadata[r['originalEventID']]['drug_code']),('event_type',r['eventType']),('route_leg',metadata[r['originalEventID']]['route_leg'])]:
            groups[(dimension,key,r['outcome'])].append(r)
    if not simulated:
        performance=[{'dimension':dim,'group':key,'outcome':outcome,**durations(rows)} for (dim,key,outcome),rows in sorted(groups.items())]
        write_csv(output/'latency.csv',performance)
        import datetime
        buckets=defaultdict(Counter)
        for r in outcomes:
            for field,count in [('admittedAt','admitted'),('requestStartedAt','request_started'),('responseEndedAt',r['outcome'])]:
                t=datetime.datetime.fromisoformat(r[field].replace('Z','+00:00')).timestamp();buckets[int(t)//10*10][count]+=1
        write_csv(output/'rates-10s.csv',({'window_start_epoch_seconds':t,'window_seconds':10,**{k:counts[k] for k in ('admitted','request_started','accepted','rule_rejection','structural_rejection','unknown_failure','fabric_failure','transport_failure','rule_execution_failure')}} for t in range(min(buckets),max(buckets)+10,10) for counts in [buckets[t]]))
    resources=list((bundle/'resources').glob('*.jsonl')) if (bundle/'resources').exists() else []
    resource_issues=[];heap_trends=[]
    if not simulated:
        host=[];docker=[]
        for file in resources:
            rows=list(map(json.loads,file.read_text().splitlines()))
            if file.name.startswith('process-'):host.extend(rows)
            elif file.name=='docker.jsonl':docker.extend(rows)
        for pid in sorted({r['pid'] for r in host}):
            samples=[r for r in host if r['pid']==pid and r.get('phase')=='measurement']
            samples=sorted(samples,key=lambda r:int(r['monotonicNs']))
            retained=samples[len(samples)//5:]
            if len(retained)>=3:
                x=[(int(r['monotonicNs'])-int(retained[0]['monotonicNs']))/1e9 for r in retained];y=[r['heapUsed']/2**20 for r in retained]
                mx,my=statistics.mean(x),statistics.mean(y);denom=sum((v-mx)**2 for v in x)
                slope=sum((a-mx)*(b-my) for a,b in zip(x,y))/denom if denom else None
                heap_trends.append({'pid':pid,'samples':len(retained),'heap_slope_MiB_per_second':slope,'method':'OLS of sampled heap after first 20% of measurement samples; includes GC fluctuations, not proof of retained-memory leak'})
            if any((int(b['monotonicNs'])-int(a['monotonicNs']))/1e9>15 for a,b in zip(samples,samples[1:])):resource_issues.append('Worker resource sampling gap >15s')
        if not any(r.get('phase')=='measurement' for r in host):resource_issues.append('No worker measurement resources')
        if not docker or any(r.get('collectorError') or r.get('exitCode',0) for r in docker):resource_issues.append('Missing/failed Docker resources')
        container_file=bundle/'resources/containers.jsonl'
        if not container_file.exists():resource_issues.append('No container identity/restart snapshots')
        else:
            snapshots=list(map(json.loads,container_file.read_text().splitlines()))
            baseline={}
            for snapshot in snapshots:
                if snapshot.get('exitCode',0):resource_issues.append('Container snapshot failure')
                for c in snapshot.get('containers',[]):
                    if any(token in c.get('name','') for token in ('peer','orderer','couch','dev-')):
                        key=c['name'];signature=(c['restartCount'],c['startedAt'])
                        if key in baseline and baseline[key]!=signature:resource_issues.append('Fabric container restarted: '+key)
                        baseline[key]=signature
        status_file=bundle/'run-status.json'
        if not status_file.exists() or json.loads(status_file.read_text())['status']=='incomplete':resource_issues.append('Missing or incomplete supervised run status')
    result={'mode':'simulated functional verification; no performance claims' if simulated else 'Fabric capture',
        'base':base,'audit_issues':issues,'timing_error_count':len(timing_errors),'resource_issues':resource_issues,
        'passed':base['passed'] and not issues and not timing_errors and not resource_issues,
        'audited_events':len(audited_events),'audited_products':len(audited_products),
        'product_groups':len(product),'latency_group_count':len(performance),'heap_trends':heap_trends}
    (output/'evaluation.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('bundle',type=Path);parser.add_argument('--simulated',action='store_true');parser.add_argument('--worker',type=Path)
    args=parser.parse_args();result=analyze(args.bundle,args.simulated,args.worker);print(json.dumps(result,indent=2));raise SystemExit(0 if result['passed'] else 1)
