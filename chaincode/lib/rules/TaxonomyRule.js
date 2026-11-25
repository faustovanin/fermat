'use strict';

class RuleResult {
    constructor({ passed, errorCode, message, score = 0 }) {
        this.passed = passed;
        this.errorCode = errorCode || null;
        this.message = message || null;
        this.score = score; // counterfeit score contribution (0–100)
    }

    static pass() {
        return new RuleResult({ passed: true, score: 0 });
    }

    static fail(errorCode, message, score = 50) {
        return new RuleResult({ passed: false, errorCode, message, score });
    }
}

/**
 * Abstract base class for all anti-counterfeit taxonomy rules.
 *
 * Each subclass implements evaluate(ctx, event) and returns a RuleResult.
 * Rules are stateless — all context comes from the Fabric stub via ctx.
 */
class TaxonomyRule {
    constructor(name, description) {
        if (new.target === TaxonomyRule) {
            throw new Error('TaxonomyRule is abstract');
        }
        this.name = name;
        this.description = description;
    }

    // eslint-disable-next-line no-unused-vars
    async evaluate(ctx, event) {
        throw new Error(`${this.constructor.name} must implement evaluate()`);
    }
}

module.exports = { TaxonomyRule, RuleResult };
