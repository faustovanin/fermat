'use strict';

const BizStep = {
    COMMISSIONING:   'commissioning',
    PACKING:         'packing',
    SHIPPING:        'shipping',
    RECEIVING:       'receiving',
    INSPECTING:      'inspecting',
    STOCKING:        'stocking',
    DISPENSING:      'dispensing',
    DECOMMISSIONING: 'decommissioning',
    DESTROYING:      'destroying',
    ENCODING:        'encoding',
    HOLDING:         'holding',
};

const Disposition = {
    ACTIVE:               'active',
    IN_TRANSIT:           'in_transit',
    IN_PROGRESS:          'in_progress',
    RECALLED:             'recalled',
    DESTROYED:            'destroyed',
    EXPIRED:              'expired',
    DAMAGED:              'damaged',
    UNKNOWN:              'unknown',
    SELLABLE_ACCESSIBLE:  'sellable_accessible',
    SELLABLE_NOT_ACCESSIBLE: 'sellable_not_accessible',
    NEEDS_REPLACEMENT:    'needs_replacement',
};

const EventType = {
    OBJECT:         'ObjectEvent',
    AGGREGATION:    'AggregationEvent',
    TRANSACTION:    'TransactionEvent',
    TRANSFORMATION: 'TransformationEvent',
    ASSOCIATION:    'AssociationEvent',
};

const ActionType = {
    ADD:     'ADD',
    DELETE:  'DELETE',
    OBSERVE: 'OBSERVE',
};

const Jurisdiction = {
    EU:      'EU',
    US:      'US',
    UNKNOWN: 'UNKNOWN',
};

// Authorized bizStep transitions in pharmaceutical supply chain (CBV-based)
const AUTHORIZED_TRANSITIONS = {
    [BizStep.ENCODING]:        [BizStep.COMMISSIONING],
    [BizStep.COMMISSIONING]:   [BizStep.PACKING, BizStep.SHIPPING],
    [BizStep.PACKING]:         [BizStep.SHIPPING],
    [BizStep.SHIPPING]:        [BizStep.RECEIVING, BizStep.DECOMMISSIONING, BizStep.HOLDING],
    [BizStep.HOLDING]:         [BizStep.SHIPPING, BizStep.INSPECTING, BizStep.DESTROYING],
    [BizStep.RECEIVING]:       [BizStep.INSPECTING, BizStep.STOCKING, BizStep.SHIPPING, BizStep.DISPENSING],
    [BizStep.INSPECTING]:      [BizStep.STOCKING, BizStep.DESTROYING, BizStep.SHIPPING],
    [BizStep.STOCKING]:        [BizStep.DISPENSING, BizStep.SHIPPING],
    [BizStep.DISPENSING]:      [BizStep.DECOMMISSIONING, BizStep.DESTROYING],
    [BizStep.DECOMMISSIONING]: [],
    [BizStep.DESTROYING]:      [],
};

// Status vocabulary reserved for a separate compliance policy; not used in diversion scoring.
const BLOCKED_DISPOSITIONS = new Set([
    Disposition.RECALLED,
    Disposition.DESTROYED,
    Disposition.EXPIRED,
]);

// bizSteps allowed for cross-jurisdiction (EU↔US) events
const CROSS_JURISDICTION_STEPS = new Set([
    BizStep.SHIPPING,
    BizStep.RECEIVING,
]);

const MANDATORY_FIELDS = ['eventID', 'eventTime', 'bizStep', 'epcList'];

const ErrorCode = {
    MISSING_MANDATORY_FIELD:              'MISSING_MANDATORY_FIELD',
    INVALID_EVENT_TIME:                   'INVALID_EVENT_TIME',
    DUPLICATE_EVENT:                      'DUPLICATE_EVENT',
    LOGISTICS_DIVERSION_SEQUENCE:         'LOGISTICS_DIVERSION_SEQUENCE',
    LOGISTICS_DIVERSION_JURISDICTION:     'LOGISTICS_DIVERSION_JURISDICTION',
    LOGISTICS_DIVERSION_TIMING:           'LOGISTICS_DIVERSION_TIMING',
    // Legacy codes retained for historical records; no current rule emits these.
    LOGISTICS_DIVERSION_BLOCKED_STATUS:       'LOGISTICS_DIVERSION_BLOCKED_STATUS',
    LOGISTICS_DIVERSION_BLOCKED_DISPOSITION:  'LOGISTICS_DIVERSION_BLOCKED_DISPOSITION',
    PHYSICAL_TAMPERING_SENSOR_EXCEPTION:  'PHYSICAL_TAMPERING_SENSOR_EXCEPTION',
    POST_MARKET_FRAUD_EXPIRED:            'POST_MARKET_FRAUD_EXPIRED',
    POST_MARKET_FRAUD_RECALLED:           'POST_MARKET_FRAUD_RECALLED',
    // Class B — Supply Base Complexity (Skilton et al., 2024, doi:10.1002/joom.1335)
    SUPPLY_BASE_COMPLEXITY:               'SUPPLY_BASE_COMPLEXITY',
};

const STATE_KEY_PREFIX = {
    EVENT:   'event_',
    PRODUCT: 'product_state_',
    HIST:    'hist_',
};

module.exports = {
    BizStep,
    Disposition,
    EventType,
    ActionType,
    Jurisdiction,
    AUTHORIZED_TRANSITIONS,
    BLOCKED_DISPOSITIONS,
    CROSS_JURISDICTION_STEPS,
    MANDATORY_FIELDS,
    ErrorCode,
    STATE_KEY_PREFIX,
};
