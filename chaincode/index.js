'use strict';
const TraceabilityContract = require('./lib/traceabilityContract');
// Preserve direct import compatibility and expose Fabric's required contract list.
module.exports = TraceabilityContract;
module.exports.contracts = [TraceabilityContract];
