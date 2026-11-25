'use strict';

let ContractBase;
try {
    ContractBase = require('fabric-contract-api').Contract;
} catch (e) {
    ContractBase = class { constructor(name) { this.name = name; } };
}

const RuleEngine              = require('./RuleEngine');
const LogisticsDiversionRule  = require('./rules/LogisticsDiversionRule');
const SupplyBaseComplexityRule = require('./rules/SupplyBaseComplexityRule');
const { STATE_KEY_PREFIX }    = require('./constants/EpcisConstants');

class TraceabilityContract extends ContractBase {
    constructor() {
        super('TraceabilityContract');
        this.ruleEngine = new RuleEngine();
    }

    async createEpcisEvent(ctx, eventJsonStr) {
        let event;
        try {
            event = JSON.parse(eventJsonStr);
        } catch (e) {
            throw new Error(`INVALID_JSON: ${e.message}`);
        }

        const evaluation = await this.ruleEngine.evaluate(ctx, event);

        if (!evaluation.passed) {
            const primary = evaluation.errors[0];
            throw new Error(`${primary.errorCode}: ${primary.message}`);
        }

        event.counterfeitScore = evaluation.counterfeitScore;
        event.isValid = true;

        await ctx.stub.putState(STATE_KEY_PREFIX.EVENT + event.eventID, Buffer.from(JSON.stringify(event)));

        await LogisticsDiversionRule.updateProductState(ctx, event);
        await SupplyBaseComplexityRule.updateComplexityState(ctx, event);

        if (event.parentID) {
            const histKey = STATE_KEY_PREFIX.HIST + event.parentID;
            const histBytes = await ctx.stub.getState(histKey);
            let list = [];
            try { list = (histBytes && histBytes.length > 0) ? JSON.parse(histBytes.toString()) : []; } catch (e) { list = []; }
            list.push(event.eventID);
            await ctx.stub.putState(histKey, Buffer.from(JSON.stringify(list)));
        }

        return JSON.stringify({ status: 'SUCCESS', eventID: event.eventID, counterfeitScore: evaluation.counterfeitScore });
    }

    // Backward-compatible alias
    async createEPCISEvent(ctx, eventJsonStr) {
        return this.createEpcisEvent(ctx, eventJsonStr);
    }

    async declareEventError(ctx, targetEventID, errorReasonJsonStr) {
        const key = STATE_KEY_PREFIX.EVENT + targetEventID;
        const bytes = await ctx.stub.getState(key);
        if (!bytes || bytes.length === 0) throw new Error(`Event ${targetEventID} not found`);

        const event = JSON.parse(bytes.toString());
        let reason;
        try { reason = JSON.parse(errorReasonJsonStr); } catch (e) { reason = { reason: String(errorReasonJsonStr) }; }

        event.errorDeclaration = { declarationTime: new Date().toISOString(), reason };
        event.isValid = false;

        await ctx.stub.putState(key, Buffer.from(JSON.stringify(event)));
        return JSON.stringify({ status: 'SUCCESS', eventID: targetEventID });
    }

    async queryEventExists(ctx, id) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.EVENT + id);
        return JSON.stringify({ exists: Boolean(bytes && bytes.length > 0) });
    }

    async queryEvent(ctx, id) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.EVENT + id);
        if (!bytes || bytes.length === 0) throw new Error(`Event ${id} not found`);
        return bytes.toString();
    }

    async queryProductState(ctx, epc) {
        const bytes = await ctx.stub.getState(STATE_KEY_PREFIX.PRODUCT + epc);
        if (!bytes || bytes.length === 0) throw new Error(`Product state for EPC ${epc} not found`);
        return bytes.toString();
    }

    async queryEventsByMango(ctx, queryStr) {
        const iterator = await ctx.stub.getQueryResult(queryStr);
        const results = [];
        while (true) {
            const res = await iterator.next();
            if (res.done) break;
            if (res.value && res.value.value) {
                let v;
                try { v = JSON.parse(res.value.value.toString()); } catch (e) { v = res.value.value.toString(); }
                results.push({ Key: res.value.key, Record: v });
            }
        }
        try { await iterator.close(); } catch (e) { /* ignore */ }
        return JSON.stringify(results);
    }
}

module.exports = TraceabilityContract;
