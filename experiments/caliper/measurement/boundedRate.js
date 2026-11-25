'use strict';
const state=require('./runtime');
module.exports.createRateController=function(message){
    const opts=message.getRateControlSpec().opts||{};
    const limit=Number(opts.concurrency||1);
    if(!Number.isInteger(limit)||limit<1||limit>16)throw new Error('Concurrency must be 1..16');
    state.limit=limit;
    return {async applyRateControl(){
        while(state.pending>=limit || (state.pending>0 && state.canAdmit && !state.canAdmit())){
            if(state.fatal)throw state.fatal;
            await new Promise(resolve=>setTimeout(resolve,5));
        }
        if(state.fatal)throw state.fatal;
    },async end(){}};
};
