'use strict';

const { TaxonomyRule, RuleResult } = require('./TaxonomyRule');
const { ErrorCode } = require('../constants/EpcisConstants');

class EventTimeRule extends TaxonomyRule {
    constructor() {
        super('EventTimeRule', 'Validates eventTime is a valid ISO 8601 string (Class A)');
    }

    async evaluate(ctx, event) {
        const { eventTime } = event;

        if (typeof eventTime !== 'string') {
            return RuleResult.fail(ErrorCode.INVALID_EVENT_TIME, 'eventTime must be a string', 100);
        }

        if (isNaN(new Date(eventTime).getTime())) {
            return RuleResult.fail(ErrorCode.INVALID_EVENT_TIME, 'eventTime is not a valid ISO 8601 date', 100);
        }

        return RuleResult.pass();
    }
}

module.exports = EventTimeRule;
