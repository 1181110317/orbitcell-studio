'use strict';
const assert = require('node:assert/strict');
const { policy, shortLabel, description, order } = require('../../public/model-picker');
const providerCatalog = [
  {providerId:'gateway',id:'flash',reasoning:true,efforts:['none','low','high','max']},
  {providerId:'gateway',id:'sol',reasoning:true,efforts:['low','medium','high','xhigh','max','ultra']},
  {providerId:'manual',id:'flash',reasoning:false,efforts:[]},
];
const base={agent:'claude',providerId:'gateway',providerCatalog};
assert.deepEqual(policy({...base,model:'flash'}).levels,['none','low','high','max']);
assert.deepEqual(policy({...base,model:'sol'}).levels,['low','medium','high','xhigh','max']);
assert.deepEqual(policy({...base,providerId:'manual',model:'flash'}).levels,[],'equal names on different connections do not share metadata');
assert.deepEqual(policy({...base,model:'gpt-6-unknown'}).levels,[],'a name never invents slider stops');
assert.deepEqual(policy({...base,agent:'zcode',model:'flash'}).levels,['low','high','max'],'ZCode never offers an unsupported disable switch');
assert.deepEqual(policy({agent:'codex',model:'native',agentCatalog:[{id:'native',reasoningLevels:['low','high','ultra']}]}).levels,['low','high','ultra']);
assert.deepEqual(policy({...base,agent:'dsh',model:'flash'}).levels,['none','low','high','max']);
assert.deepEqual(policy({agent:'dsh',model:'route/native',agentCatalog:[{id:'route/native',reasoningLevels:['low','high','max']}]}).levels,['low','high','max']);
assert.match(policy({...base,model:'missing',failed:true}).note,/失败/);
for (const effort of order) assert.equal(shortLabel(effort),effort,'the composer uses the English protocol name');
assert.equal(shortLabel(''),'default');
assert.equal(shortLabel('unknown'),'default');
assert.match(description('max'),/更长时间/);
console.log('[model-picker] exact model/provider tiers, native catalog, unsupported switches, English labels and unknown metadata passed');

const nativeReasoning={id:'reasoning-mode',currentValue:'low',options:[{value:'off',name:'Off'},{value:'low',name:'Low'},{value:'high',name:'High'}]};
for(const agent of ['acp:workbuddy','acp:cursor-acp','gemini','opencode'])assert.deepEqual(policy({agent,nativeReasoning}).levels,['none','low','high']);
assert.deepEqual(policy({...base,agent:'zcode',model:'sol'}).levels,['low','high','max']);
