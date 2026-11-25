"""Short, deterministic synthetic EU-US histories with explicit independent labels."""
import csv
import hashlib
import json
import math
import random
from collections import defaultdict, Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .load import make_event, make_aggregation_event, make_transaction_event, make_item_identifier

CODES = {'out_of_order':'LOGISTICS_DIVERSION_SEQUENCE',
         'timestamp_mismatch':'LOGISTICS_DIVERSION_TIMING',
         'jurisdiction':'LOGISTICS_DIVERSION_JURISDICTION',
         'many_suppliers':'SUPPLY_BASE_COMPLEXITY'}
EU_MAKER='urn:epc:id:pgln:4000001.00001'
EU_HUB='urn:epc:id:pgln:4000001.00002'


def select_rows(source, histories, seed):
    groups=defaultdict(list)
    with Path(source).open(newline='') as stream:
        for index,row in enumerate(csv.DictReader(stream),1):
            groups[row['drug_code']].append({**row,'source_row':index})
    rng=random.Random(seed);codes=sorted(groups);rng.shuffle(codes)
    for rows in groups.values():rng.shuffle(rows)
    selected=[]
    while len(selected)<histories:
        advanced=False
        for code in codes:
            if len(selected)==histories:break
            if groups[code]:selected.append(groups[code].pop());advanced=True
        if not advanced:raise ValueError('Insufficient unique source rows; no automatic duplication')
    return selected


def history(row, index, kind='none'):
    txn=f"euus-row-{row['source_row']}|{row['drug_code']}"
    item_ref=str(int(hashlib.sha256(row['drug_code'].encode()).hexdigest()[:12],16)%1_000_000).zfill(6)
    epc=make_item_identifier(txn,0,row['drug_code'],item_ref=item_ref)
    sscc=f'urn:epc:id:sscc:4000001.{index:010d}'
    us=f"urn:epc:id:pgln:us.dea.{row['buyer_id']}"
    sgln=lambda party:party.replace(':pgln:',':sgln:')+'.0'
    maker,hub,importer=map(sgln,(EU_MAKER,EU_HUB,us))
    # Synthetic route chronology, not observed international transaction dates.
    base=datetime(2020,1,1,tzinfo=timezone.utc)+timedelta(days=index%30)
    times=[base+timedelta(hours=h) for h in (0,1,2,3,24,48,49,336,337,338)]
    specs=[('ObjectEvent','commissioning',maker,EU_MAKER,EU_MAKER,'origin'),
           ('ObjectEvent','packing',maker,EU_MAKER,EU_MAKER,'origin'),
           ('ADD','packing',maker,EU_MAKER,EU_MAKER,'origin'),
           ('ObjectEvent','shipping',maker,EU_MAKER,EU_HUB,'eu_domestic'),
           ('ObjectEvent','receiving',hub,EU_MAKER,EU_HUB,'eu_domestic'),
           ('ObjectEvent','shipping',hub,EU_HUB,us,'overseas'),
           ('TransactionEvent','shipping',hub,EU_HUB,us,'overseas'),
           ('ObjectEvent','receiving',importer,EU_HUB,us,'us_import'),
           ('DELETE','receiving',importer,us,us,'us_import'),
           ('TransactionEvent','receiving',importer,us,us,'us_import')]
    events=[];meta=[]
    for j,(typ,step,location,src,dst,leg) in enumerate(specs):
        disposition='in_transit' if step=='shipping' else 'active'
        if typ=='ObjectEvent':
            e=make_event(epc,step,disposition,times[j],location,location,sgln(src),src,sgln(dst),dst,txn)
        elif typ in ('ADD','DELETE'):
            e=make_aggregation_event(sscc,[epc],typ,step,disposition,times[j],location,location,sgln(src),src,sgln(dst),dst,txn)
        else:
            e=make_transaction_event([epc],'urn:epcglobal:cbv:btt:desadv' if step=='shipping' else 'urn:epcglobal:cbv:btt:recadv',txn,step,disposition,times[j],location,src,dst,txn)
        e['eventID']='urn:uuid:'+hashlib.sha256(f'{txn}|euus-v1|{j}'.encode()).hexdigest()[:32]
        for field,key,party in [('sourceList','source',src),('destinationList','destination',dst)]:
            for entry in e[field]:entry['jurisdiction']='US' if ':us.dea.' in party else 'EU'
        events.append(e)
        meta.append({'eventID':e['eventID'],'transaction_id':txn,'drug_code':row['drug_code'],
                     'item_epc':epc,'route_leg':leg,'history_index':index,'event_index':j,
                     'source_row':row['source_row'],'original_transaction_id':row['transaction_id']})
    targets=[]
    if kind=='timestamp_mismatch':
        events[7]['eventTime']=(times[5]-timedelta(seconds=1)).strftime('%Y-%m-%dT%H:%M:%SZ');targets=[events[7]['eventID']]
    elif kind=='out_of_order':
        events[7]['bizStep']='packing';targets=[events[7]['eventID']]
    elif kind=='jurisdiction':
        # Transaction observation avoids a physical-transition confound.
        events[6]['bizStep']='stocking';targets=[events[6]['eventID']]
    elif kind=='many_suppliers':
        events[7]['sourceList'].extend({'type':'owning_party','source':f'urn:diagnostic:supplier:{i}','jurisdiction':'EU'} for i in range(3))
        targets=[events[7]['eventID']]
    elif kind in ('recalled','blocked'):
        for e in events:e['disposition']=kind
    elif kind!='none':raise ValueError('Unsupported mechanism: '+kind)
    label={'transaction_id':txn,'drug_code':row['drug_code'],'injected':kind!='none',
           'anomaly_type':kind,'diversion_anomaly':kind in CODES,
           'history_event_ids':[e['eventID'] for e in events],'history_epcs':[epc],
           'target_event_ids':targets,'expected_rule_code':CODES.get(kind),
           'status_control_event_ids':[e['eventID'] for e in events] if kind in ('recalled','blocked') else [],
           'coverage_status':'mapped' if kind in CODES else 'negative_control' if kind!='none' else 'clean_control'}
    for m in meta:m.update(anomaly_type=kind,diversion_anomaly=label['diversion_anomaly'],is_target=m['eventID'] in targets,expected_rule_code=CODES.get(kind))
    return events,meta,label


def generate(source, output, event_count, seed=42, anomaly_rate=.01, diagnostic=False):
    if event_count%10 or event_count<=0:raise ValueError('Event count must be a positive multiple of ten')
    if not 0<=anomaly_rate<=1:raise ValueError('Invalid anomaly rate')
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    n=event_count//10;rows=select_rows(source,n,seed)
    codes={row['drug_code'] for row in rows}
    refs={str(int(hashlib.sha256(code.encode()).hexdigest()[:12],16)%1_000_000).zfill(6) for code in codes}
    if len(refs)!=len(codes):raise ValueError('Synthetic item-reference collision; supply a documented collision-free mapping')
    kinds=['none']*n
    if diagnostic:
        if n<7:raise ValueError('Diagnostic requires at least seven histories')
        kinds[:7]=['none','recalled','blocked','out_of_order','timestamp_mismatch','jurisdiction','many_suppliers']
    else:
        rng=random.Random(seed);chosen=rng.sample(range(n),math.floor(n*anomaly_rate))
        for j,index in enumerate(chosen):kinds[index]=('out_of_order','timestamp_mismatch')[(j+(seed%2))%2]
    histories=[history(row,i,kind) for i,(row,kind) in enumerate(zip(rows,kinds))]
    # Round robin gives every product early coverage while preserving each history.
    events=[h[0][j] for j in range(10) for h in histories]
    metadata=[h[1][j] for j in range(10) for h in histories]
    (output/'events.json').write_text(json.dumps({'type':'EPCISDocument','schemaVersion':'2.0','epcisBody':{'eventList':events}},indent=2)+'\n')
    with (output/'event-metadata.jsonl').open('w') as stream:
        for m in metadata:stream.write(json.dumps(m)+'\n')
    with (output/'scenario.csv').open('w',newline='') as stream:
        fields=['transaction_id','drug_code','anomaly_type','source_row','original_transaction_id']
        writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
        for row,h in zip(rows,histories):writer.writerow({k:h[2].get(k,row.get(k,row['transaction_id'] if k=='original_transaction_id' else '')) for k in fields})
    labels=[h[2] for h in histories]
    truth={'label_schema':'euus-v1','label_unit':'transaction','transactions':n,
        'injected_transactions':sum(r['injected'] for r in labels),
        'diversion_anomaly_transactions':sum(r['diversion_anomaly'] for r in labels),
        'events_sha256':hashlib.sha256((output/'events.json').read_bytes()).hexdigest(),
        'counts_by_type':dict(Counter(kinds)),'records':labels}
    (output/'ground_truth.json').write_text(json.dumps(truth,indent=2)+'\n')
    manifest={'profile':'euus-v1','seed':seed,'requested_rate':anomaly_rate,'diagnostic':diagnostic,
        'events':len(events),'items':n,'product_codes':dict(Counter(r['drug_code'] for r in rows)),
        'source':str(Path(source).resolve()),'source_sha256':hashlib.sha256(Path(source).read_bytes()).hexdigest(),
        'events_sha256':truth['events_sha256'],'injected_histories':truth['diversion_anomaly_transactions'],
        'synthetic_item_references':{code:str(int(hashlib.sha256(code.encode()).hexdigest()[:12],16)%1_000_000).zfill(6) for code in sorted(codes)},
        'scope':'Synthetic EU-US routes and synthetic EPC trade-item references using archived domestic product codes; not real GTINs or observed overseas trade.'}
    (output/'dataset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest
