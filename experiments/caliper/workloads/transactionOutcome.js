'use strict';
const RISK_CODES=['LOGISTICS_DIVERSION_SEQUENCE','LOGISTICS_DIVERSION_TIMING',
    'LOGISTICS_DIVERSION_JURISDICTION','SUPPLY_BASE_COMPLEXITY'];
const STRUCTURAL_CODES=['MISSING_MANDATORY_FIELD','INVALID_EVENT_TIME','DUPLICATE_EVENT','INVALID_JSON'];
function classifyOutcome(response) {
    const tx=Array.isArray(response) && response.length===1 ? response[0] : response;
    if(!tx || typeof tx.GetStatus!=='function')throw new Error('Missing or ambiguous Caliper transaction status');
    const result=typeof tx.GetResult==='function'?tx.GetResult():null;
    const errors=typeof tx.GetErrMsg==='function'?tx.GetErrMsg():[];
    const resultText=result==null?'':String(result);
    const messages=Array.isArray(errors)?errors.map(e=>typeof e==='string'?e:JSON.stringify(e)):[String(errors)];
    const status=tx.GetStatus();
    const verified=typeof tx.IsVerified==='function' && Boolean(tx.IsVerified());
    const flag=typeof tx.GetFlag==='function'?tx.GetFlag():null;
    const text=[resultText,...messages].join('\n');
    const record={status,reportedVerified:verified,transactionID:typeof tx.GetID==='function'?tx.GetID():null,
        validationFlag:flag,result:resultText,errorMessages:messages,ruleCodes:[],outcome:'unknown_failure',safeToContinue:false};
    if(status==='success') {
        record.outcome='accepted';record.safeToContinue=true;
        try{const parsed=JSON.parse(resultText);if(typeof parsed.counterfeitScore==='number')record.counterfeitScore=parsed.counterfeitScore;}catch{}
        return record;
    }
    // Infrastructure evidence takes precedence even if a nested message mentions a rule.
    if(/MVCC|PHANTOM_READ_CONFLICT|ENDORSEMENT_POLICY_FAILURE|INVALID_OTHER_REASON/.test(text) || (flag!==null && flag!==0 && flag!=='VALID')) {
        record.outcome='fabric_failure';return record;
    }
    if(/timeout|timed out|deadline|ECONN|UNAVAILABLE|connection|socket/i.test(text)) {
        record.outcome='transport_failure';return record;
    }
    if(/\bRULE_EXECUTION_ERROR\b/.test(text)) {record.outcome='rule_execution_failure';return record;}
    const codes=[...RISK_CODES,...STRUCTURAL_CODES].filter(code=>new RegExp('\\b'+code+'\\b').test(text));
    if(status==='failed' && verified && codes.length===1) {
        record.ruleCodes=codes;
        record.outcome=RISK_CODES.includes(codes[0])?'rule_rejection':'structural_rejection';
        record.safeToContinue=true;
    }
    return record;
}
module.exports={classifyOutcome};
