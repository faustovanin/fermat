'use strict';
// Local rule/contract replay, not Fabric consensus, endorsement or load measurement.
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2]);
const Contract = require(path.join(root, 'lib/traceabilityContract'));
const events = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).epcisBody.eventList;
const state = new Map();
// Buffer writes until acceptance: atomic rollback without copying the full ledger.
const pending = new Map();
const ctx = {stub: {getState: async k => pending.get(k) || state.get(k) || Buffer.alloc(0),
    putState: async (k,v) => pending.set(k,v)}};
(async () => {
    const contract = new Contract();
    for (const event of events) {
        pending.clear();
        const evaluation = await contract.ruleEngine.evaluate(ctx, event);
        let accepted = false, executionError = null;
        try {
            await contract.createEpcisEvent(ctx, JSON.stringify(event));
            for (const [k,v] of pending) state.set(k,v);
            accepted = true;
        } catch (error) {
            executionError = error.message;
            pending.clear();
        }
        process.stdout.write(JSON.stringify({eventID:event.eventID,
            transaction_id:event.ilmd['cbvmda:transactionID'], eventType:event.type,
            epcs:event.epcList || event.childEPCs, accepted,
            counterfeitScore:evaluation.counterfeitScore,
            rules:evaluation.errors, executionError})+'\n');
    }
    if(process.argv[4])fs.writeFileSync(process.argv[4],JSON.stringify(Object.fromEntries([...state].filter(([key])=>key.startsWith('product_state_')).map(([key,value])=>[key,JSON.parse(value.toString())])),null,2));
})().catch(error => {console.error(error); process.exit(1);});
