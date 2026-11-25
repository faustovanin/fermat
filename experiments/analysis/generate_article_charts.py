"""Editable article figures from the completed seed-42 Fabric size series."""
import argparse
from collections import Counter, defaultdict
import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path

DEFAULTS={
 'font_family':'DejaVu Sans','font_size':10,'title_size':11,'dpi':300,
 'colors':['#0072B2','#E69F00','#009E73'],
 'titles':{
  '01-performance':'Performance across dataset sizes',
  '02-latency-distributions':'Accepted and rejected request latency',
  '03-confusion-matrices':'Complete-history classification',
  '04-anomaly-targets':'Expected anomaly targets and observed detections',
  '05-product-coverage':'Completed item histories by product code',
  '06-product-latency':'Accepted-request latency by product code',
  '07-route-latency':'Accepted-request latency along the overseas route',
  '08-process-resources':'Worker memory and CPU during measured submissions',
  '09-fabric-resources':'Fabric container resources: 5,000-event capture'},
 'labels':{'volume':'Measured events','latency':'Request-to-adapter-return latency (ms)',
           'time':'Elapsed measurement time (minutes)','product':'Source product code'},
 'figure_sizes':{'01-performance':[8,3.5],'02-latency-distributions':[8,3.5],
  '03-confusion-matrices':[9,3.3],'04-anomaly-targets':[7,3.5],
  '05-product-coverage':[9,4],'06-product-latency':[9,4],
  '07-route-latency':[9,4],'08-process-resources':[9,7],
  '09-fabric-resources':[9,5.5]}}


def rows(file):
    with file.open() as stream:
        for line in stream:
            if line.strip():yield json.loads(line)


def csv_write(file,records):
    records=list(records)
    if not records:return
    with file.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(records[0]));writer.writeheader();writer.writerows(records)


def timestamp(value):return dt.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()


def generate(suite,output,config_path=None):
    output.mkdir(parents=True,exist_ok=True);data_dir=output/'data';data_dir.mkdir(exist_ok=True)
    config_path=config_path or output/'chart-settings.json'
    if not config_path.exists():config_path.write_text(json.dumps(DEFAULTS,indent=2)+'\n')
    cfg=json.loads(json.dumps(DEFAULTS));custom=json.loads(config_path.read_text())
    for key,value in custom.items():
        if isinstance(value,dict):cfg[key].update(value)
        else:cfg[key]=value
    os.environ.setdefault('MPLCONFIGDIR',str(output/'.matplotlib-cache'))
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import numpy as np
    plt.rcParams.update({'font.family':cfg['font_family'],'font.size':cfg['font_size'],
                         'axes.titlesize':cfg['title_size'],'svg.fonttype':'none','pdf.fonttype':42,
                         'axes.spines.top':False,'axes.spines.right':False,'axes.prop_cycle':plt.cycler(color=cfg['colors'])})
    colors=cfg['colors'];runs=[];sources=set();exports=[]
    for size in (100,1000,5000):
        bundle=suite/f'euus-{size}-s42'/'mixed'
        files=[bundle/'analysis/evaluation.json',bundle/'capture/worker/submissions.jsonl',
               bundle/'ground_truth.json',bundle/'analysis/latency.csv',bundle/'run-status.json']
        sources.update(files)
        evaluation=json.loads(files[0].read_text())
        if evaluation['mode']!='Fabric capture' or not evaluation['passed']:raise ValueError('Actual complete evaluation required: '+str(bundle))
        submissions=list(rows(files[1]));truth=json.loads(files[2].read_text());lookup={r['originalEventID']:r for r in submissions}
        if len(submissions)!=size:raise ValueError('Unexpected event count')
        histories=[]
        for label in truth['records']:
            alarm=any(lookup[e]['outcome'] in ('rule_rejection','structural_rejection') for e in label['history_event_ids'])
            actual='tp' if label['diversion_anomaly'] and alarm else 'fn' if label['diversion_anomaly'] else 'fp' if alarm else 'tn'
            histories.append({'events':size,'seed':42,'product_code':label['drug_code'],'history_id':label['transaction_id'],'anomaly_type':label['anomaly_type'],'classification':actual})
        start=min(timestamp(r['requestStartedAt']) for r in submissions)
        elapsed=(max(int(r['responseEndMonotonicNs']) for r in submissions)-min(int(r['requestStartMonotonicNs']) for r in submissions))/1e9
        accepted=[r['serviceMs'] for r in submissions if r['outcome']=='accepted']
        counts=Counter(r['classification'] for r in histories)
        summary={'events':size,'seed':42,'items':len(histories),'product_codes':len({r['product_code'] for r in histories}),
            'accepted':len(accepted),'rejected':size-len(accepted),'targets':evaluation['base']['targets'],
            'matched_targets':evaluation['base']['expected_target_matches'],'tp':counts['tp'],'fp':counts['fp'],'tn':counts['tn'],'fn':counts['fn'],
            'measurement_seconds':elapsed,'responses_per_second':size/elapsed,'accepted_per_second':len(accepted)/elapsed,
            'accepted_median_ms':float(np.median(accepted)),'accepted_p95_ms':float(np.percentile(accepted,95)),
            'accepted_p99_ms':float(np.percentile(accepted,99))}
        runs.append({'size':size,'bundle':bundle,'submissions':submissions,'truth':truth,'histories':histories,'summary':summary,'start':start})
    csv_write(data_dir/'run-summary.csv',[r['summary'] for r in runs])
    csv_write(data_dir/'histories.csv',[row for run in runs for row in run['histories']])
    csv_write(data_dir/'events.csv',({'events_in_run':run['size'],**{k:r.get(k) for k in ('originalEventID','historyId','drug_code','eventType','bizStep','route_leg','anomaly_type','is_target','outcome','requestStartedAt','responseEndedAt','queueWaitMs','serviceMs','endToEndMs','requestBytes','inFlightAtStart')}} for run in runs for r in run['submissions']))
    def figure(name,nrows=1,ncols=1,**kwargs):return plt.subplots(nrows,ncols,figsize=cfg['figure_sizes'][name],layout='constrained',**kwargs)
    def save(fig,name):
        title=cfg['titles'].get(name,'')
        if title:fig.suptitle(title,fontsize=cfg['title_size'])
        for ext in ('svg','pdf','png'):
            folder=output/ext;folder.mkdir(exist_ok=True);file=folder/(name+'.'+ext)
            fig.savefig(file,dpi=cfg['dpi']);exports.append(str(file.relative_to(output)))
        plt.close(fig)
    labels=[f"{r['size']:,}" for r in runs];x=np.arange(3)
    fig,axes=figure('01-performance',1,2)
    for key,marker,label in [('accepted_median_ms','o','Median'),('accepted_p95_ms','s','p95'),('accepted_p99_ms','^','p99')]:
        axes[0].plot(x,[r['summary'][key] for r in runs],marker=marker,label=label)
    axes[0].set_xticks(x,labels);axes[0].set_xlabel(cfg['labels']['volume']);axes[0].set_ylabel('Accepted-request latency (ms)');axes[0].legend();axes[0].grid(axis='y',alpha=.2)
    axes[1].bar(x,[r['summary']['responses_per_second'] for r in runs],color=colors)
    axes[1].set_xticks(x,labels);axes[1].set_xlabel(cfg['labels']['volume']);axes[1].set_ylabel('All completed responses/s');axes[1].set_ylim(bottom=0)
    for i,r in enumerate(runs):axes[1].text(i,r['summary']['responses_per_second'],f"{r['summary']['responses_per_second']:.4f}",ha='center',va='bottom')
    save(fig,'01-performance')
    fig,axes=figure('02-latency-distributions',1,2)
    for i,run in enumerate(runs):
        for ax,outcome in zip(axes,('accepted','rule_rejection')):
            values=sorted(r['serviceMs'] for r in run['submissions'] if r['outcome']==outcome)
            if values:ax.step(values,np.arange(1,len(values)+1)/len(values),where='post',color=colors[i],label=f"{run['size']:,} events (n={len(values):,})")
    for ax,label in zip(axes,('Accepted requests','Rule-rejected requests')):
        ax.set_title(label);ax.set_xlabel(cfg['labels']['latency']);ax.set_ylabel('Cumulative fraction');ax.legend(fontsize=8);ax.grid(alpha=.2)
    save(fig,'02-latency-distributions')
    fig,axes=figure('03-confusion-matrices',1,3)
    for ax,run in zip(axes,runs):
        c=run['summary'];matrix=np.array([[c['tn'],c['fp']],[c['fn'],c['tp']]])
        ax.imshow(matrix,cmap='Blues',vmin=0,vmax=max(1,matrix.max()))
        for i in range(2):
            for j in range(2):ax.text(j,i,str(matrix[i,j]),ha='center',va='center',color='white' if matrix[i,j]>matrix.max()/2 else 'black',fontsize=12)
        ax.set_xticks([0,1],['No alert','Alert']);ax.set_yticks([0,1],['Clean','Anomalous']);ax.set_title(f"{run['size']:,} events; {c['items']} histories")
    save(fig,'03-confusion-matrices')
    target_rows=[]
    for run in runs:
        lookup={r['originalEventID']:r for r in run['submissions']}
        for kind in ('out_of_order','timestamp_mismatch'):
            relevant=[r for r in run['truth']['records'] if r['anomaly_type']==kind]
            planned=sum(len(r['target_event_ids']) for r in relevant)
            detected=sum(lookup[e]['outcome']=='rule_rejection' and r['expected_rule_code'] in lookup[e]['ruleCodes'] for r in relevant for e in r['target_event_ids'])
            target_rows.append({'events':run['size'],'mechanism':kind,'planned':planned,'detected':detected})
    csv_write(data_dir/'targets.csv',target_rows)
    fig,ax=figure('04-anomaly-targets');width=.34
    for i,(kind,label) in enumerate([('out_of_order','Sequence'),('timestamp_mismatch','Timestamp')]):
        selected=[r for r in target_rows if r['mechanism']==kind];values=[r['detected'] for r in selected]
        bars=ax.bar(x+(i-.5)*width,values,width,label=label,color=colors[i])
        for bar,r in zip(bars,selected):ax.text(bar.get_x()+bar.get_width()/2,bar.get_height()+.05,f"{r['detected']}/{r['planned']}",ha='center',fontsize=9)
    ax.set_xticks(x,labels);ax.set_xlabel(cfg['labels']['volume']);ax.set_ylabel('Detected targets (labels: detected/planned)');ax.legend();ax.set_ylim(0,max(r['planned'] for r in target_rows)+1)
    save(fig,'04-anomaly-targets')
    codes=sorted({h['product_code'] for run in runs for h in run['histories']});positions=np.arange(len(codes))
    product_rows=[]
    for run in runs:
        for code in codes:
            selected=[r['serviceMs'] for r in run['submissions'] if r['drug_code']==code and r['outcome']=='accepted']
            product_rows.append({'events':run['size'],'product_code':code,'histories':sum(h['product_code']==code for h in run['histories']),
                                 'accepted_events':len(selected),'median_ms':float(np.median(selected)) if selected else None,
                                 'p95_ms':float(np.percentile(selected,95)) if len(selected)>=20 else None})
    csv_write(data_dir/'products.csv',product_rows)
    fig,ax=figure('05-product-coverage')
    for i,run in enumerate(runs):
        data=[r for r in product_rows if r['events']==run['size']];ax.bar(positions+(i-1)*.25,[r['histories'] for r in data],.25,label=f"{run['size']:,} events",color=colors[i])
    ax.set_xticks(positions,codes,rotation=50,ha='right');ax.set_ylabel('Completed one-item histories');ax.set_xlabel(cfg['labels']['product']);ax.legend();save(fig,'05-product-coverage')
    fig,ax=figure('06-product-latency')
    for i,run in enumerate(runs):
        selected=[r for r in product_rows if r['events']==run['size']]
        med=[r['median_ms'] if r['median_ms'] is not None else np.nan for r in selected]
        ax.plot(positions,med,'o-',color=colors[i],label=f"{run['size']:,} events: median")
        upper=[r['p95_ms'] if r['p95_ms'] is not None else np.nan for r in selected]
        ax.plot(positions,upper,'_:',color=colors[i],alpha=.7,label=f"{run['size']:,}: p95 (n≥20)")
    ax.set_xticks(positions,codes,rotation=50,ha='right');ax.set_xlabel(cfg['labels']['product']);ax.set_ylabel('Accepted-request latency (ms)');ax.legend(ncols=2,fontsize=8);ax.grid(axis='y',alpha=.2);save(fig,'06-product-latency')
    legs=['origin','eu_domestic','overseas','us_import'];route_rows=[];fig,ax=figure('07-route-latency')
    for i,run in enumerate(runs):
        values=[]
        for leg in legs:
            selected=[r['serviceMs'] for r in run['submissions'] if r['route_leg']==leg and r['outcome']=='accepted']
            route_rows.append({'events':run['size'],'route_leg':leg,'accepted_events':len(selected),'median_ms':float(np.median(selected)),'p95_ms':float(np.percentile(selected,95)) if len(selected)>=20 else None})
            values.append(float(np.median(selected)))
        ax.plot(range(4),values,'o-',color=colors[i],label=f"{run['size']:,} events")
    ax.set_xticks(range(4),['EU manufacturer','EU inland transport','EU→US shipping','US import receipt']);ax.set_ylabel('Accepted-request median latency (ms)');ax.legend();ax.grid(axis='y',alpha=.2);save(fig,'07-route-latency');csv_write(data_dir/'route-latency.csv',route_rows)
    fig,axes=figure('08-process-resources',3,2);resource_rows=[]
    for i,run in enumerate(runs):
        samples=[]
        for file in (run['bundle']/'resources').glob('process-*.jsonl'):
            sources.add(file);samples.extend(r for r in rows(file) if r.get('phase')=='measurement')
        samples.sort(key=lambda r:r['timestamp'])
        if not samples:raise ValueError('Missing measured worker resources')
        t=[(timestamp(r['timestamp'])-run['start'])/60 for r in samples]
        axes[i,0].plot(t,[r['rss']/2**20 for r in samples],label='RSS',color=colors[0],linewidth=.8)
        axes[i,0].plot(t,[r['heapUsed']/2**20 for r in samples],label='V8 heap used',color=colors[1],linewidth=.8)
        axes[i,1].plot(t,[r['cpuPercentOneCore'] for r in samples],color=colors[2],linewidth=.8)
        axes[i,0].set_ylabel(f"{run['size']:,} events\nMemory (MiB)");axes[i,1].set_ylabel('CPU (% of one core)')
        axes[i,0].legend(fontsize=8);axes[i,0].set_ylim(bottom=0);axes[i,1].set_ylim(bottom=0)
        for r,minutes in zip(samples,t):resource_rows.append({'events':run['size'],'elapsed_minutes':minutes,'pid':r['pid'],'rss_MiB':r['rss']/2**20,'heap_used_MiB':r['heapUsed']/2**20,'cpu_percent_one_core':r['cpuPercentOneCore'],'pending':r['pending'],'completed':r['completed']})
    for ax in axes[-1]:ax.set_xlabel(cfg['labels']['time'])
    save(fig,'08-process-resources');csv_write(data_dir/'worker-resources.csv',resource_rows)
    import re
    run=runs[-1];file=run['bundle']/'resources/docker.jsonl';sources.add(file);container=defaultdict(list);docker_rows=[]
    for sample in rows(file):
        minutes=(timestamp(sample['timestamp'])-run['start'])/60
        for c in sample.get('containers',[]):
            name=c.get('Name','')
            if not re.search(r'peer|orderer|couch|dev-',name):continue
            match=re.match(r'([\d.]+)([kKMG]?i?B)',c.get('MemUsage','').split('/')[0].strip())
            if not match:continue
            multiplier={'B':1,'kB':1000,'KB':1000,'KiB':1024,'MB':10**6,'MiB':2**20,'GB':10**9,'GiB':2**30}[match[2]]
            record={'elapsed_minutes':minutes,'container':name,'memory_MiB':float(match[1])*multiplier/2**20,'docker_cpu_percent':float(c['CPUPerc'].rstrip('%'))}
            container[name].append(record);docker_rows.append(record)
    fig,axes=figure('09-fabric-resources',2,1,sharex=True)
    for name,values in sorted(container.items()):
        short=name if not name.startswith('dev-') else name.split('-traceability')[0]+'-chaincode'
        t=[v['elapsed_minutes'] for v in values];axes[0].plot(t,[v['memory_MiB'] for v in values],label=short,linewidth=.7)
        axes[1].plot(t,[v['docker_cpu_percent'] for v in values],linewidth=.7)
    axes[0].set_ylabel('Container memory (MiB)');axes[0].legend(fontsize=7,ncols=2);axes[1].set_ylabel('Docker CPU (%)');axes[1].set_xlabel('Elapsed from first submission (minutes; includes audit tail)')
    for ax in axes:ax.set_ylim(bottom=0)
    save(fig,'09-fabric-resources');csv_write(data_dir/'fabric-resources-5000.csv',docker_rows)
    manifest={'matplotlibVersion':matplotlib.__version__,'numpyVersion':np.__version__,'series':'Actual complete seed-42 Fabric captures, one per size',
              'exports':exports,'svgTextEditable':True,'sources_sha256':{str(p.relative_to(suite)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(sources)}}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'output':str(output),'figures':len(exports)//3,'exports':len(exports)},indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('suite',type=Path);p.add_argument('--output',type=Path);p.add_argument('--settings',type=Path)
    a=p.parse_args();generate(a.suite.resolve(),(a.output or a.suite/'article-charts').resolve(),a.settings)
