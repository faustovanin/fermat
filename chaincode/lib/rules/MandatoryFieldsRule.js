'use strict';

const { TaxonomyRule, RuleResult } = require('./TaxonomyRule');
const { epcsOf } = require('../EpcisMapping');
const { ErrorCode, MANDATORY_FIELDS } = require('../constants/EpcisConstants');

class MandatoryFieldsRule extends TaxonomyRule {
    constructor() {
        super('MandatoryFieldsRule', 'Validates required EPCIS 2.0 fields are present and well-formed (Class A)');
    }

    async evaluate(ctx, event) {
        for (const field of MANDATORY_FIELDS.filter(field => field !== 'epcList')) {
            if (!Object.prototype.hasOwnProperty.call(event, field) || event[field] == null) {
                return RuleResult.fail(
                    ErrorCode.MISSING_MANDATORY_FIELD,
                    `Missing mandatory field: ${field}`,
                    100
                );
            }
        }

        if (event.type && !['ObjectEvent', 'AggregationEvent', 'TransactionEvent'].includes(event.type)) {
            return RuleResult.fail(ErrorCode.MISSING_MANDATORY_FIELD, 'Unsupported event type', 100);
        }
        if (event.type === 'AggregationEvent' && (typeof event.parentID !== 'string' || !event.parentID.trim())) {
            return RuleResult.fail(ErrorCode.MISSING_MANDATORY_FIELD, 'AggregationEvent requires parentID', 100);
        }
        const epcs = epcsOf(event);
        if (!Array.isArray(epcs) || epcs.length === 0 || epcs.some(epc => typeof epc !== 'string' || !epc.trim())) {
            return RuleResult.fail(
                ErrorCode.MISSING_MANDATORY_FIELD,
                'epcList (or childEPCs for AggregationEvent) must contain EPC identifiers',
                100
            );
        }

        return RuleResult.pass();
    }
}

module.exports = MandatoryFieldsRule;
