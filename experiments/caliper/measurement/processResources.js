'use strict';
// NODE_OPTIONS preload runs in the Caliper manager and all Node worker processes.
const fs=require('fs');const path=require('path');
const {monitorEventLoopDelay}=require('perf_hooks');
const state=require('./runtime');
if(process.env.EPCIS_RESOURCE_DIR){
    const folder=process.env.EPCIS_RESOURCE_DIR;fs.mkdirSync(folder,{recursive:true});
    const file=path.join(folder,`process-${process.pid}.jsonl`);
    const loop=monitorEventLoopDelay({resolution:20});loop.enable();
    let cpu=process.cpuUsage(),last=process.hrtime.bigint();
    const sample=()=>{
        const now=process.hrtime.bigint(),elapsedMs=Number(now-last)/1e6,used=process.cpuUsage();
        fs.appendFileSync(file,JSON.stringify({schemaVersion:1,runId:process.env.EPCIS_RUN_ID,
            timestamp:new Date().toISOString(),monotonicNs:String(now),pid:process.pid,ppid:process.ppid,
            argv:process.argv,phase:state.phase,completed:state.completed,pending:state.pending,
            cpuPercentOneCore:100*((used.user-cpu.user)+(used.system-cpu.system))/(elapsedMs*1000),
            sampleIntervalMs:elapsedMs,...process.memoryUsage(),eventLoopMeanMs:Number.isFinite(loop.mean)?loop.mean/1e6:null,
            eventLoopMaxMs:loop.max/1e6})+'\n');
        cpu=used;last=now;loop.reset();
    };
    const timer=setInterval(sample,1000);timer.unref();
    process.once('exit',()=>{clearInterval(timer);sample();loop.disable();});
}
