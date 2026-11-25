'use strict';

/**
 * SupplyBaseComplexityRule — Class B (Logistics Diversion)
 *
 * Detects diversion risk based on the number of distinct suppliers
 * delivering to the same buyer location (bizLocation).
 *
 * Theoretical foundation:
 *   Skilton et al. (2024) demonstrate empirically, using DEA/ARCOS data
 *   (2006–2019), that supply base complexity — measured as the number of
 *   distinct outside suppliers per pharmacy — is positively and significantly
 *   related to diversion risk in pharmaceutical supply chains (p < .001).
 *
 *   Key statistics from Skilton et al. (2024), Table 1:
 *     - Mean supply base complexity:  3.12 suppliers
 *     - Standard deviation:           1.44
 *     - 99th percentile:              ≈ 9 suppliers
 *     - Maximum observed:             31 suppliers
 *
 *   Within-firm effect: +1 supplier → +290,000 MME diversion risk/year
 *   Between-firm effect: +1 supplier → +1.28M MME diversion risk/year
 *
 * Score thresholds (derived from article statistics):
 *   ≤ 3 suppliers  → score 0   (within mean, normal)
 *   4–5 suppliers  → score 30  (above mean + 1 SD, elevated)
 *   6–8 suppliers  → score 60  (well above mean, high risk)
 *   ≥ 9 suppliers  → score 85  (99th percentile, critical)
 *
 * EPCIS mapping:
 *   bizLocation  → buyer (pharmacy GLN or DEA-derived identifier)
 *   sourceList   → reporter/distributor (supplier GLN or DEA-derived identifier)
 *   Each distinct sourceList value per bizLocation = one supplier in the supply base
 *
 * References:
 *   [1] Skilton, P.F., Mackelprang, A., Sepehrirad, R., & Bernardes, E. (2024).
 *       Supply base attributes and diversion risk in a supply chain for hazardous
 *       pharmaceutical products. Journal of Operations Management, 71(3), 373–392.
 *       https://doi.org/10.1002/joom.1335
 *
 *   [2] Gundlach, G.T. et al. (2010). "Product diversion involves the distribution
 *       of products into markets other than those originally intended, in violation
 *       of a contract, law, or regulation." (p. 103)
 *
 *   [3] GS1 EPCIS 2.0 Standard — sourceList / destinationList CBV vocabulary.
 *       https://ref.gs1.org/standards/epcis
 *
 *   [4] ARCOS data: DEA opioid transactions 2006–2019, made public by
 *       The Washington Post.
 *       https://www.washingtonpost.com/graphics/2019/investigations/dea-pain-pill-database/
 */

const { idOf, suppliersOf } = require('../EpcisMapping');
const { TaxonomyRule, RuleResult } = require('./TaxonomyRule');
const { ErrorCode, STATE_KEY_PREFIX, BizStep } = require('../constants/EpcisConstants');

// Thresholds derived from Skilton et al. (2024), Table 1
const COMPLEXITY_THRESHOLDS = [
    { minSuppliers: 9, score: 85, label: 'CRITICAL'  }, // ≥ 99th percentile
    { minSuppliers: 6, score: 60, label: 'HIGH'      }, // well above mean
    { minSuppliers: 4, score: 30, label: 'ELEVATED'  }, // above mean + 1 SD
];

// Only track complexity on receiving events (buyer perspective)
const TRACKED_BIZ_STEPS = new Set([BizStep.RECEIVING, BizStep.STOCKING, BizStep.DISPENSING]);

const COMPLEXITY_STATE_PREFIX = 'supply_complexity_';

class SupplyBaseComplexityRule extends TaxonomyRule {
    constructor() {
        super(
            'SupplyBaseComplexityRule',
            'Detects elevated diversion risk from high supply base complexity at buyer location (Class B). ' +
            'Based on Skilton et al. (2024): +1 supplier → +290,000 MME diversion risk/year.'
        );
    }

    async evaluate(ctx, event) {
        // Only evaluate on receiving-side events with known buyer location and source
        if (!TRACKED_BIZ_STEPS.has(event.bizStep)) return RuleResult.pass();
        if (!idOf(event.bizLocation))                     return RuleResult.pass();
        if (!Array.isArray(event.sourceList) || event.sourceList.length === 0) return RuleResult.pass();

        const complexityKey = COMPLEXITY_STATE_PREFIX + idOf(event.bizLocation);
        const stateBytes    = await ctx.stub.getState(complexityKey);

        const complexityState = (stateBytes && stateBytes.length > 0)
            ? JSON.parse(stateBytes.toString())
            : { suppliers: [] };

        // Extract supplier identifiers from sourceList
        const newSuppliers = suppliersOf(event);

        // Merge with known suppliers (deduplicated)
        const knownSet   = new Set(complexityState.suppliers);
        newSuppliers.forEach(s => knownSet.add(s));
        const totalCount = knownSet.size;

        // Evaluate score based on thresholds from Skilton et al. (2024)
        for (const threshold of COMPLEXITY_THRESHOLDS) {
            if (totalCount >= threshold.minSuppliers) {
                return RuleResult.fail(
                    ErrorCode.SUPPLY_BASE_COMPLEXITY,
                    `${threshold.label}: bizLocation '${event.bizLocation}' has received from ` +
                    `${totalCount} distinct suppliers (threshold: ${threshold.minSuppliers}). ` +
                    `Skilton et al. (2024): +1 supplier ≈ +290,000 MME diversion risk/year. ` +
                    `[doi:10.1002/joom.1335]`,
                    threshold.score
                );
            }
        }

        return RuleResult.pass();
    }

    /**
     * Persists updated supplier set for a buyer location.
     * Call after all rules pass, alongside LogisticsDiversionRule.updateProductState().
     */
    static async updateComplexityState(ctx, event) {
        if (!TRACKED_BIZ_STEPS.has(event.bizStep)) return;
        if (!idOf(event.bizLocation)) return;
        if (!Array.isArray(event.sourceList) || event.sourceList.length === 0) return;

        const complexityKey = COMPLEXITY_STATE_PREFIX + idOf(event.bizLocation);
        const stateBytes    = await ctx.stub.getState(complexityKey);

        const complexityState = (stateBytes && stateBytes.length > 0)
            ? JSON.parse(stateBytes.toString())
            : { suppliers: [] };

        const knownSet = new Set(complexityState.suppliers);
        suppliersOf(event).forEach(s => knownSet.add(s));

        complexityState.suppliers    = Array.from(knownSet);
        complexityState.supplierCount = complexityState.suppliers.length;
        complexityState.lastUpdated  = event.eventTime;

        await ctx.stub.putState(complexityKey, Buffer.from(JSON.stringify(complexityState)));
    }
}

module.exports = SupplyBaseComplexityRule;
