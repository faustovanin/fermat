"""Prepare the EU-US study; only local replay is executed, never Docker/reset."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import shutil
import subprocess
import sys

WORKSPACE=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(WORKSPACE/'epcis-arcos-etl-generator'))
from pipeline.eu_us import generate
from evaluate_caliper_capture import evaluate


def prepare_dataset(source,folder,event_count,seed,rate,diagnostic=False):
    manifest=generate(source,folder,event_count,seed,rate,diagnostic)
    with (folder/'local-reference.jsonl').open('w') as stream:
        subprocess.run(['node',str(Path(__file__).with_name('replay_current_chaincode.js')),
            str(WORKSPACE/'teste-smartcontract/chaincode/traceability'),str(folder/'events.json'),str(folder/'local-product-state.json')],stdout=stream,check=True)
    rows=[json.loads(line) for line in (folder/'local-reference.jsonl').read_text().splitlines()]
    lookup={r['eventID']:r for r in rows};truth=json.loads((folder/'ground_truth.json').read_text())
    clean_alerts=[];target_misses=[]
    for r in truth['records']:
        if not r['diversion_anomaly']:
            clean_alerts.extend(eid for eid in r['history_event_ids'] if not lookup[eid]['accepted'])
        for target in r['target_event_ids']:
            if not any(e['errorCode']==r['expected_rule_code'] for e in lookup[target]['rules']):target_misses.append(target)
    summary={'mode':'in-memory current-contract reference, not Fabric performance','events':len(rows),
        'accepted':sum(r['accepted'] for r in rows),'rejected':sum(not r['accepted'] for r in rows),
        'clean_alerts':clean_alerts,'target_misses':target_misses,'targets':sum(len(r['target_event_ids']) for r in truth['records'])}
    (folder/'local-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
    if clean_alerts or target_misses:raise ValueError(f'Local reference failed: {folder}')
    run_id=folder.parent.name+'-'+folder.name
    subprocess.run(['node',str(WORKSPACE/'teste-smartcontract/caliper/tools/prepareCapture.js'),str(folder/'events.json'),run_id,str(folder/'capture')],check=True,stdout=subprocess.DEVNULL)
    (folder/'manifest.json').write_text(json.dumps({**manifest,'runId':run_id,'execution':'Prepared; actual Fabric capture pending'},indent=2)+'\n')
    return {'bundle':str(folder.relative_to(folder.parent.parent)),'events':event_count,'seed':seed,'diagnostic':diagnostic,
            'rate':rate,'runId':run_id,'local_validation':summary}


def prepare(source,output):
    output=output.resolve();output.mkdir(parents=True,exist_ok=False)
    records=[]
    for seed in (7,42,123):
        for count in (100,1000,5000):
            records.append(prepare_dataset(source,output/f'euus-{count}-s{seed}'/'mixed',count,seed,.01))
            if count>=1000:records.append(prepare_dataset(source,output/f'euus-{count}-s{seed}'/'control',count,seed,0))
    records.append(prepare_dataset(source,output/'euus-diagnostic-s42'/'diagnostic',70,42,0,True))
    smoke=prepare_dataset(source,output/'euus-smoke-s42'/'mixed',100,42,.01);smoke['smoke']=True;records.append(smoke)
    random.Random(20261025).shuffle(records)
    revisions={}
    snapshot=output/'source_snapshot'
    for name,src in [('chaincode',WORKSPACE/'teste-smartcontract/chaincode/traceability/lib'),
                     ('etl',WORKSPACE/'epcis-arcos-etl-generator/pipeline'),
                     ('workloads',WORKSPACE/'teste-smartcontract/caliper/workloads'),
                     ('measurement',WORKSPACE/'teste-smartcontract/caliper/measurement'),
                     ('tools',WORKSPACE/'teste-smartcontract/caliper/tools'),('analysis',Path(__file__).parent)]:
        shutil.copytree(src,snapshot/name,ignore=shutil.ignore_patterns('__pycache__'))
    for repo in ('teste-smartcontract','epcis-arcos-etl-generator','blockchain-research'):
        path=WORKSPACE/repo
        patch=subprocess.check_output(['git','-C',str(path),'diff','HEAD','--binary'])
        (output/(repo+'.patch')).write_bytes(patch)
        revisions[repo]={'commit':subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip(),
                         'branch':subprocess.check_output(['git','-C',str(path),'branch','--show-current'],text=True).strip(),
                         'patch_sha256':hashlib.sha256(patch).hexdigest()}
    hashes={str(p.relative_to(output)):hashlib.sha256(p.read_bytes()).hexdigest() for p in output.rglob('*') if p.is_file()}
    (output/'sha256.json').write_text(json.dumps(hashes,indent=2)+'\n')
    suite={'schemaVersion':1,'status':'prepared_local_validated','revisions':revisions,'scheduleSeed':20261025,
           'captures':records,'initial_smoke':'euus-smoke-s42/mixed','notes':'Run smoke then diagnostic before randomized replicated schedule. Equal-code selection; synthetic EU-US route. No actual Fabric claims.'}
    (output/'suite.json').write_text(json.dumps(suite,indent=2)+'\n')
    print(json.dumps({'suite':str(output),'captures':len(records),'local_validation':'passed'},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--source',type=Path,default=WORKSPACE/'blockchain-research/RUN_2026-09-27_multiscale/d1000_e10000/scenario_template.csv')
    args=parser.parse_args();prepare(args.source,args.output)
