'use strict';

const { epcsOf, jurisdictionOf } = require('../EpcisMapping');
const { TaxonomyRule, RuleResult } = require('./TaxonomyRule');
const {
    ErrorCode,
    STATE_KEY_PREFIX,
    AUTHORIZED_TRANSITIONS,
    CROSS_JURISDICTION_STEPS,
} = require('../constants/EpcisConstants');

/**
 * Logistics Diversion Rule — Class B (Circulation & Operational Control)
 *
 * Detects: unauthorized bizStep transitions, out-of-order event times,
 * and cross-jurisdiction moves
 * outside authorized steps.
 *
 * Designed to work with generic EPCIS 2.0 / CBV data (e.g. from ARCOS conversions).
 * No hardcoded coordinates or business-specific fields.
 */
class LogisticsDiversionRule extends TaxonomyRule {
    constructor() {
        super(
            'LogisticsDiversionRule',
            'Detects logistics diversion: sequence violations, timing and jurisdiction mismatches (Class B)'
        );
    }

    async evaluate(ctx, event) {
        // Disposition is product-status metadata, not evidence of diversion.
        // Compliance restrictions, if introduced, must be a separate policy.
        for (const epc of epcsOf(event)) {
            const stateKey = STATE_KEY_PREFIX.PRODUCT + epc;
            const stateBytes = await ctx.stub.getState(stateKey);

            if (!stateBytes || stateBytes.length === 0) {
                continue; // first event for this EPC — no history to compare
            }

            const productState = JSON.parse(stateBytes.toString());

            // ObjectEvents describe physical circulation. Aggregation/transaction
            // observations have independent clocks and do not replay that transition.
            const physical = !event.type || event.type === 'ObjectEvent';
            const previousTime = physical ? productState.lastEventTime
                : productState.observationsByType?.[event.type]?.eventTime;

            // Rule 1: bizStep must be an authorized transition from the last recorded step
            const authorizedNext = AUTHORIZED_TRANSITIONS[productState.lastBizStep];
            if (physical && authorizedNext !== undefined && !authorizedNext.includes(event.bizStep)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_SEQUENCE,
                    `Invalid bizStep transition for EPC ${epc}: ` +
                    `'${productState.lastBizStep}' → '${event.bizStep}' is not authorized`,
                    75
                );
            }

            // Rule 2: event time must not precede the last recorded event time
            if (previousTime) {
                const lastTime = new Date(previousTime).getTime();
                const newTime  = new Date(event.eventTime).getTime();
                if (newTime < lastTime) {
                    return RuleResult.fail(
                        ErrorCode.LOGISTICS_DIVERSION_TIMING,
                        `Out-of-order event for EPC ${epc}: ` +
                        `new eventTime (${event.eventTime}) precedes last recorded (${previousTime})`,
                        60
                    );
                }
            }


        }

        // Rule 3: cross-jurisdiction events must occur only at authorized bizSteps
        const srcJurisdiction = jurisdictionOf(event.sourceList, 'source');
        const dstJurisdiction = jurisdictionOf(event.destinationList, 'destination');

        if (srcJurisdiction && dstJurisdiction && srcJurisdiction !== dstJurisdiction) {
            if (!CROSS_JURISDICTION_STEPS.has(event.bizStep)) {
                return RuleResult.fail(
                    ErrorCode.LOGISTICS_DIVERSION_JURISDICTION,
                    `Cross-jurisdiction event (${srcJurisdiction} → ${dstJurisdiction}) ` +
                    `at unauthorized bizStep '${event.bizStep}'`,
                    80
                );
            }
        }

        return RuleResult.pass();
    }

    /**
     * Persists product state after an event is accepted.
     * Called by TraceabilityContract after all rules pass.
     */
    static async updateProductState(ctx, event) {
        for (const epc of epcsOf(event)) {
            const stateKey = STATE_KEY_PREFIX.PRODUCT + epc;
            const stateBytes = await ctx.stub.getState(stateKey);

            const productState = (stateBytes && stateBytes.length > 0)
                ? JSON.parse(stateBytes.toString())
                : { history: [] };

            if (!event.type || event.type === 'ObjectEvent') {
                productState.lastBizStep = event.bizStep;
                productState.lastEventTime = event.eventTime;
                productState.lastLocation = event.bizLocation || null;
            } else {
                productState.observationsByType = productState.observationsByType || {};
                productState.observationsByType[event.type] = {
                    bizStep: event.bizStep, eventTime: event.eventTime,
                    location: event.bizLocation || null,
                };
            }
            productState.disposition = event.disposition || productState.disposition || null;
            productState.history.push(event.eventID);

            await ctx.stub.putState(stateKey, Buffer.from(JSON.stringify(productState)));
        }
    }

}

module.exports = LogisticsDiversionRule;
