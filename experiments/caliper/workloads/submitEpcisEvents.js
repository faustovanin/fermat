'use strict';
const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const fs = require('fs');
const path = require('path');
const {classifyOutcome} = require('./transactionOutcome');
const {loadDataset, namespaceEvent} = require('./epcisDataset');
const runtime=require('../measurement/runtime');

function historyOf(event){return event.ilmd?.['cbvmda:transactionID']||(event.epcList||event.childEPCs||[event.eventID]).join('|');}

function statusOf(response) {
    const result = Array.isArray(response) ? response[0] : response;
    if (!result || typeof result.GetStatus !== 'function') throw new Error('Missing Caliper transaction status');
    return result;
}
function requireSuccess(response) {
    const status = statusOf(response);
    if (status.GetStatus() !== 'success') throw new Error('Testbed initialization request failed');
    return status;
}

class SubmitEpcisEventsWorkload extends WorkloadModuleBase {
    constructor() {
        super(); this._eventIndex = 0; this._tail = Promise.resolve(); this._fatal = null;
    }
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, args, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex,totalWorkers,roundIndex,args,sutAdapter,sutContext);
        if (totalWorkers !== 1 || workerIndex !== 0) throw new Error('Correctness capture requires exactly one worker');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(args.runId || '')) throw new Error('A unique runId is required (letters/digits/_/-)');
        if (!args.outputDir) throw new Error('A new outputDir is required');
        const dataset = loadDataset(args.inputFile);
        if (args.expectedEvents !== dataset.events.length) throw new Error('expectedEvents must equal the full dataset event count');
        this._events = dataset.events.map(event => namespaceEvent(event,args.runId));
        this._originals = dataset.events;
        this._runId=args.runId;
        this._contractId = args.contractId || 'traceability';
        this._identity={invokerIdentity:args.invokerIdentity||'User1',invokerMspId:args.invokerMspId||'Org1MSP'};
        fs.mkdirSync(args.outputDir,{recursive:false});
        this._log = path.join(args.outputDir,'submissions.jsonl');
        fs.writeFileSync(path.join(args.outputDir,'mapping.json'),JSON.stringify({runId:args.runId,
            datasetSha256:dataset.sha256,roundIndex,workerIndex,events:dataset.events.map((event,i)=>({
                originalEventID:event.eventID,submittedEventID:this._events[i].eventID,
                originalEpcs:event.epcList||event.childEPCs,
                submittedEpcs:this._events[i].epcList||this._events[i].childEPCs}))},null,2));
        // Reserve a run namespace before measurement, so partial prior runs cannot be replayed.
        const markerID = `urn:testbed:run:${args.runId}`;
        const check = requireSuccess(await this.sutAdapter.sendRequests({...this._identity,contractId:this._contractId,
            contractFunction:'queryEventExists',contractArguments:[markerID],readOnly:true}));
        const payload = JSON.parse(check.GetResult().toString());
        if (typeof payload.exists !== 'boolean') throw new Error('Invalid namespace check response');
        if (payload.exists) throw new Error('runId already used; choose a new namespace');
        const marker={type:'ObjectEvent',eventID:markerID,eventTime:'2000-01-01T00:00:00Z',
            bizStep:'commissioning',epcList:[`urn:testbed:marker-product:${args.runId}`]};
        requireSuccess(await this.sutAdapter.sendRequests({...this._identity,contractId:this._contractId,
            contractFunction:'createEpcisEvent',contractArguments:[JSON.stringify(marker)],readOnly:false}));
        this._eventIndex=0;
        this._bounded=Boolean(args.bounded);
        this._requestTimeoutMs=Number(args.requestTimeoutMs||120000);
        if(!Number.isFinite(this._requestTimeoutMs)||this._requestTimeoutMs<=0)throw new Error('Invalid requestTimeoutMs');
        this._pending=0;this._busyHistories=new Set();this._remaining=this._events.map((_,i)=>i);
        this._tasks=new Set();this._maxPending=Number(args.maxPending||64);
        this._metadata=args.metadataFile?new Map(fs.readFileSync(args.metadataFile,'utf8').trim().split('\n').map(line=>{const r=JSON.parse(line);return [r.eventID,r];})):new Map();
        this._audit=Boolean(args.audit);
        this._auditFile=path.join(args.outputDir,'ledger-audit.jsonl');
        runtime.pending=0;runtime.completed=0;runtime.fatal=null;runtime.phase='measurement';
        runtime.canAdmit=()=>this._remaining.some(i=>!this._busyHistories.has(historyOf(this._originals[i])));
    }
    submitTransaction() {
        if(this._fatal)return Promise.reject(this._fatal);
        // A bounded Caliper controller may dispatch one final callback after its
        // last wait. It must not replay an event or create an artificial failure.
        if(this._bounded && !this._remaining.length)return Promise.resolve();
        if(this._pending >= (this._bounded?runtime.limit:this._maxPending)){
            this._fatal=new Error('Admission bound exceeded; use boundedRate controller');runtime.fatal=this._fatal;
            return Promise.reject(this._fatal);
        }
        const admittedAt=new Date().toISOString(),admitted=process.hrtime.bigint();
        this._pending++;runtime.pending++;
        const execute=async()=>{
            if(this._fatal)throw this._fatal;
            let index;
            if(this._bounded){
                const position=this._remaining.findIndex(i=>!this._busyHistories.has(historyOf(this._originals[i])));
                if(position<0)throw new Error('No independent history available for bounded admission');
                index=this._remaining.splice(position,1)[0];
            }else{
                if(this._eventIndex>=this._events.length)throw new Error('Dataset exhausted; cyclic replay is forbidden');
                index=this._eventIndex;
            }
            this._eventIndex++;
            const event=this._events[index],original=this._originals[index];
            const history=historyOf(original);
            this._busyHistories.add(history);
            const start=process.hrtime.bigint(),requestStartedAt=new Date().toISOString(),inFlightAtStart=this._pending;
            const payload=JSON.stringify(event);let timer;
            try{
                const response=await Promise.race([
                    this.sutAdapter.sendRequests({...this._identity,contractId:this._contractId,
                        contractFunction:'createEpcisEvent',contractArguments:[payload],readOnly:false}),
                    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Request timeout; ledger outcome uncertain')),this._requestTimeoutMs);})
                ]);
                const end=process.hrtime.bigint(),outcome=classifyOutcome(response);
                fs.appendFileSync(this._log,JSON.stringify({schemaVersion:2,runId:this._runId,
                    workerId:0,...this._metadata.get(original.eventID),originalEventID:original.eventID,
                    submittedEventID:event.eventID,historyId:history,eventType:event.type,bizStep:event.bizStep,
                    admittedAt,requestStartedAt,responseEndedAt:new Date().toISOString(),
                    admittedMonotonicNs:String(admitted),requestStartMonotonicNs:String(start),responseEndMonotonicNs:String(end),
                    queueWaitMs:Number(start-admitted)/1e6,serviceMs:Number(end-start)/1e6,endToEndMs:Number(end-admitted)/1e6,
                    requestBytes:Buffer.byteLength(payload),responsePayloadBytes:Buffer.byteLength(outcome.result||''),
                    inFlightAtStart,verifiedOutcome:outcome.safeToContinue,...outcome})+'\n');
                runtime.completed++;
                if(!outcome.safeToContinue)throw new Error('Uncertain transaction outcome; halt dependent history');
                return response;
            }catch(error){
                this._fatal=error;runtime.fatal=error;
                fs.appendFileSync(this._log,JSON.stringify({originalEventID:original.eventID,
                    submittedEventID:event.eventID,executionError:error.message,halted:true,
                    timestamp:new Date().toISOString()})+'\n');
                throw error;
            }finally{clearTimeout(timer);this._busyHistories.delete(history);}
        };
        const task=(this._bounded?execute():this._tail.then(execute)).finally(()=>{
            this._pending--;runtime.pending--;this._tasks.delete(task);
        });
        this._tasks.add(task);this._tail=task.catch(()=>{});return task;
    }
    async cleanupWorkloadModule() {
        await Promise.allSettled([...this._tasks]);
        await this._tail;
        if (this._fatal) throw this._fatal;
        if (this._eventIndex!==this._events.length) throw new Error('Incomplete dataset: round ended before every event was submitted');
        if(this._audit){
            runtime.phase='audit';
            const query=async(fn,arg)=>{
                let timer;
                try{return requireSuccess(await Promise.race([
                    this.sutAdapter.sendRequests({...this._identity,contractId:this._contractId,contractFunction:fn,contractArguments:[arg],readOnly:true}),
                    new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Audit timeout')),this._requestTimeoutMs);})
                ])).GetResult().toString();}finally{clearTimeout(timer);}
            };
            const rows=fs.readFileSync(this._log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
            for(const row of rows){
                const exists=JSON.parse(await query('queryEventExists',row.submittedEventID)).exists;
                const stored=exists?JSON.parse(await query('queryEvent',row.submittedEventID)):null;
                fs.appendFileSync(this._auditFile,JSON.stringify({kind:'event',originalEventID:row.originalEventID,submittedEventID:row.submittedEventID,
                    expectedPresent:row.outcome==='accepted',exists,stored,timestamp:new Date().toISOString()})+'\n');
            }
            const epcs=new Set(this._events.flatMap(e=>e.epcList||e.childEPCs||[]));
            for(const epc of epcs){
                fs.appendFileSync(this._auditFile,JSON.stringify({kind:'product',epc,state:JSON.parse(await query('queryProductState',epc)),timestamp:new Date().toISOString()})+'\n');
            }
        }
        runtime.phase='finished';
    }
}
module.exports.createWorkloadModule=()=>new SubmitEpcisEventsWorkload();
