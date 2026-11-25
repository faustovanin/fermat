'use strict';
const fs = require('fs');
const crypto = require('crypto');

function loadDataset(filename) {
    if (!filename || !fs.existsSync(filename)) throw new Error('An existing inputFile is required; no synthetic fallback');
    const bytes = fs.readFileSync(filename);
    const raw = JSON.parse(bytes);
    const events = Array.isArray(raw) ? raw : raw?.epcisBody?.eventList;
    if (!Array.isArray(events) || !events.length) throw new Error('Expected a nonempty event array or EPCISDocument');
    const ids = new Set();
    for (const event of events) {
        if (!event || typeof event.eventID !== 'string' || !event.eventID || ids.has(event.eventID)) throw new Error('Missing or duplicate eventID');
        ids.add(event.eventID);
        const epcs = event.type === 'AggregationEvent' ? event.childEPCs : event.epcList;
        if (!Array.isArray(epcs) || !epcs.length) throw new Error('Missing item history identifiers');
    }
    return {events, sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}

function namespaceEvent(original, runId) {
    const event = JSON.parse(JSON.stringify(original));
    const suffix = `#test-run=${runId}`;
    const rename = id => typeof id === 'string' ? id + suffix : id;
    const location = value => typeof value === 'string' ? rename(value)
        : value && {...value, id:rename(value.id)};
    event.eventID = rename(event.eventID);
    for (const field of ['epcList','childEPCs']) if (event[field]) event[field] = event[field].map(rename);
    if (event.parentID) event.parentID = rename(event.parentID);
    for (const field of ['bizLocation','readPoint']) if (event[field]) event[field] = location(event[field]);
    // Party identifiers and jurisdiction evidence are domain facts, not state keys.
    // Keep them unchanged; supplier sets are isolated through namespaced buyer keys.
    return event;
}
module.exports = {loadDataset, namespaceEvent};
