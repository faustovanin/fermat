'use strict';
// Shared only within a worker process: admission observes scheduled callbacks too.
module.exports={pending:0,phase:'bootstrap',completed:0,fatal:null,limit:1};
