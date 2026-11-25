'use strict';

const idOf = value => typeof value === 'string' ? value : value && value.id;
const roleOf = entry => String(entry.type || '').split(/[\/:]/).pop();
const epcsOf = event => event.type === 'AggregationEvent' ? event.childEPCs : event.epcList;

// A supplier is the owning party at origin, not a location or a custody role.
function suppliersOf(event) {
    return [...new Set((event.sourceList || [])
        .filter(entry => roleOf(entry) === 'owning_party')
        .map(entry => entry.source || entry.value)
        .filter(value => typeof value === 'string' && value.length > 0))];
}

function jurisdictionOf(list, field) {
    for (const entry of list || []) {
        // Explicit metadata takes priority; never infer a country from a GS1 prefix.
        if (entry.jurisdiction === 'EU' || entry.jurisdiction === 'US') return entry.jurisdiction;
        const value = String(entry[field] || entry.value || '').toLowerCase();
        if (value.includes('eu.') || value.includes('.eu') || value.includes('europe')) return 'EU';
        if (value.includes('us.') || value.includes('.us') || value.includes('usa')) return 'US';
    }
    return null;
}

module.exports = { idOf, epcsOf, suppliersOf, jurisdictionOf };
