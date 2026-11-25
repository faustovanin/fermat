'use strict';

const MandatoryFieldsRule      = require('./rules/MandatoryFieldsRule');
const EventTimeRule            = require('./rules/EventTimeRule');
const DuplicateEventRule       = require('./rules/DuplicateEventRule');
const LogisticsDiversionRule   = require('./rules/LogisticsDiversionRule');
const SupplyBaseComplexityRule = require('./rules/SupplyBaseComplexityRule');

/**
 * RuleEngine — executa as regras organizadas segundo a tipologia de Wilson Engelmann
 * (UNISINOS/KAIST, abril 2026): "Functional equivalence and federated architecture
 * for global medicine traceability".
 *
 * Class A — Constituent units of the regulated object (validateStructure):
 *   Identidade do produto e semântica básica: EPC/GTIN, GLN, timestamp.
 *   "Without them, robust interoperability is impossible."
 *   Implementado como early break: um evento sem identidade bloqueia tudo.
 *
 * Class B — Circulation and operational control units (assessRisk):
 *   Captura de eventos, verificação, alertas, auditoria.
 *   "They transform the identifier into usable traceability."
 *   Todas as regras executam; scores se acumulam em um counterfeitScore.
 *
 * Class C — Federated governance units:
 *   Governança de acesso, interoperabilidade mínima, prova de integridade.
 *   Representada pela própria camada Hyperledger Fabric (blockchain como
 *   infraestrutura de confiança e auditoria transnacional).
 *
 * Class D — Innovation and experimentation units:
 *   OLIOT como testbed de arquitetura federada EPCIS 2.0.
 *   Não implementada aqui; pertence à camada de experimentação do grupo.
 */
class RuleEngine {
    constructor() {
        // Class A — identidade e semântica básica (bloqueantes)
        this.classAIdentityRules = [
            new MandatoryFieldsRule(),
            new EventTimeRule(),
            new DuplicateEventRule(),
        ];

        // Class B — controle de circulação e operação (acumulativos)
        // LogisticsDiversionRule: implementação principal, validada com base de dados ARCOS
        // (Skilton et al. 2024, doi:10.1002/joom.1335 + dados DEA 2006–2019).
        this.classBCirculationRules = [
            new LogisticsDiversionRule(),
            new SupplyBaseComplexityRule(), // derivada do mesmo estudo ARCOS (Skilton 2024)
        ];
    }

    /**
     * Class A — validação de identidade e semântica básica.
     * Para na primeira falha (early break): sem identidade, não há rastreabilidade.
     * Ref: Engelmann (2026), Class A — "constituent units of the regulated object".
     */
    async validateStructure(ctx, event) {
        for (const rule of this.classAIdentityRules) {
            try {
                const result = await rule.evaluate(ctx, event);
                if (!result.passed) {
                    return { passed: false, error: { rule: rule.name, errorCode: result.errorCode, message: result.message } };
                }
            } catch (err) {
                return { passed: false, error: { rule: rule.name, errorCode: 'RULE_EXECUTION_ERROR', message: err.message } };
            }
        }
        return { passed: true };
    }

    /**
     * Class B — controle de circulação e operação.
     * Todas as regras executam; scores acumulam em counterfeitScore.
     * Ref: Engelmann (2026), Class B — "circulation and operational control units".
     *
     * A estratégia de cálculo do counterfeitScore é injetável via scoringStrategy.
     * Por padrão usa o valor máximo (proxy conservador de risco).
     * Outras estratégias disponíveis em RuleEngine.SCORING — ou pode-se criar
     * uma interface/classe ScoringStrategy com método calculate(errors).
     */
    async assessRisk(ctx, event, scoringStrategy = RuleEngine.SCORING.MAX) {
        const errors = [];

        for (const rule of this.classBCirculationRules) {
            try {
                const result = await rule.evaluate(ctx, event);
                if (!result.passed) {
                    errors.push({ rule: rule.name, errorCode: result.errorCode, message: result.message, score: result.score });
                }
            } catch (err) {
                errors.push({ rule: rule.name, errorCode: 'RULE_EXECUTION_ERROR', message: err.message, score: 0 });
            }
        }

        const counterfeitScore = scoringStrategy(errors);
        return { errors, counterfeitScore };
    }

    /**
     * Ponto de entrada principal: executa os dois métodos em sequência.
     * Se a validação estrutural falhar, a avaliação de risco não é executada.
     */
    async evaluate(ctx, event) {
        const structural = await this.validateStructure(ctx, event);
        if (!structural.passed) {
            return { passed: false, errors: [structural.error], counterfeitScore: 0 };
        }

        const risk = await this.assessRisk(ctx, event);
        return {
            passed: risk.errors.length === 0,
            errors: risk.errors,
            counterfeitScore: risk.counterfeitScore,
        };
    }
}

module.exports = RuleEngine;

// Estratégias de scoring injetáveis em assessRisk().
// Uso: engine.assessRisk(ctx, event, RuleEngine.SCORING.WEIGHTED)
RuleEngine.SCORING = {
    MAX:      (errors) => errors.length > 0 ? Math.max(...errors.map(e => e.score)) : 0,
    SUM:      (errors) => Math.min(errors.reduce((acc, e) => acc + e.score, 0), 100),
    AVERAGE:  (errors) => errors.length > 0 ? Math.round(errors.reduce((acc, e) => acc + e.score, 0) / errors.length) : 0,
    WEIGHTED: (errors) => Math.min(errors.reduce((acc, e) => acc + e.score * 1.2, 0), 100), // placeholder — pesos a definir pelo grupo
};
