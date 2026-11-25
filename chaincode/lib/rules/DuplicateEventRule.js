'use strict';

const { TaxonomyRule, RuleResult } = require('./TaxonomyRule');
const { ErrorCode, STATE_KEY_PREFIX } = require('../constants/EpcisConstants');

class DuplicateEventRule extends TaxonomyRule {
    constructor() {
        super('DuplicateEventRule', 'Detects duplicate eventID — Document Falsification (Class B)');
    }

    async evaluate(ctx, event) {
        const key = STATE_KEY_PREFIX.EVENT + event.eventID;
        const existing = await ctx.stub.getState(key);

        if (existing && existing.length > 0) {
            return RuleResult.fail(
                ErrorCode.DUPLICATE_EVENT,
                `Duplicate eventID: ${event.eventID}`,
                100
            );
        }

        return RuleResult.pass();
    }
}

module.exports = DuplicateEventRule;
