const assert = require('node:assert/strict');
const http = require('node:http');
const source = require('../../lib/quota-source');
const quota = require('../../lib/quota');
const plans = require('../../lib/plan-quota');
module.exports = async function () {
  assert.equal(plans.source({baseUrl:'https://open.bigmodel.cn/api/anthropic'}).rawAuth,true);
  assert.equal(plans.source({baseUrl:'https://api.kimi.com/coding/v1'}).url,'https://api.kimi.com/coding/v1/usages');
  assert.equal(plans.source({baseUrl:'https://api.moonshot.cn/v1'}),null);
  assert.equal(plans.source({baseUrl:'https://open.bigmodel.cn.untrusted.example/v1'}),null);
  const z=plans.parse('zhipu-plan',{success:true,data:{limits:[{unit:3,number:5,percentage:80,nextResetTime:1893456000000},{unit:6,percentage:1},{type:'TIME_LIMIT',percentage:0},{unit:3}]}});
  assert.deepEqual(z.windows.map(w=>[w.label,w.remainingPercent]),[['5 小时',20],['每周',99],['MCP · 每月',100]]);
  assert.equal(z.windows[0].resetAt,1893456000);
  assert.equal(plans.parse('zhipu-plan',{success:false,data:{limits:[{percentage:0}]}}).supported,false);
  const k=plans.parse('kimi-code',{usage:{limit:'100',remaining:'60'},limits:[{window:{duration:300,timeUnit:'TIME_UNIT_MINUTE'},detail:{limit:'10',used:'3',resetTime:'2030-01-01T00:00:00Z'}}],usages:{limit_7d:{used_ratio:0.5},limit_month_total:{used_ratio:0.2},limit_month_code:{used_ratio:0.8}}});
  assert.deepEqual(k.windows.map(w=>[w.label,w.remainingPercent]),[['5 小时',70],['每周',50],['每月',80]]);
  assert.equal(plans.parse('kimi-code',{usage:{limit:100}}).supported,false);
  const go=plans.parse('opencode-go',{usage:{rolling:{percent:0,resetsAt:'2030-01-01'},weekly:{percent:20},monthly:{percent:100}}});
  assert.deepEqual(go.windows.map(w=>w.remainingPercent),[100,80,0]);assert.equal(go.windows[0].resetAt,null);
  assert.equal(source.sanitize({type:'json',url:'file:///secret',metrics:[{valuePath:'balance'}]}),null);
  assert.equal(source.sanitize({type:'json',url:'https://a.example/usage',metrics:[{valuePath:'__proto__.amount'}]}),null);
  const cfg = source.sanitize({type:'json',url:'http://127.0.0.1/usage',auth:'none',metrics:[
    {label:'余额',kind:'balance',valuePath:'data.balance',unit:'CNY'},
    {label:'积分',kind:'credits',valuePath:'data.credits',unit:'积分'},
    {label:'5 小时',kind:'window',basis:'usedPercent',valuePath:'data.five',windowSeconds:18000,resetPath:'data.reset'},
    {label:'每周',kind:'window',basis:'remainingPercent',valuePath:'data.week',windowSeconds:604800},
    {label:'每月',kind:'window',basis:'used',valuePath:'data.month.used',limitPath:'data.month.limit',windowSeconds:2592000,unit:'次'},
    {label:'未提供',valuePath:'data.missing'},
  ]});
  let payload = {data:{balance:'38.5',credits:1500,five:38,week:1,month:{used:20,limit:100},reset:'2030-01-01T00:00:00Z',private:'must-not-be-returned'}};
  const result = source.parse(payload,cfg);
  assert.equal(result.metrics.length,2);
  assert.deepEqual(result.windows.map(w=>[w.label,w.remainingPercent]),[['5 小时',62],['每周',1],['每月',80]]);
  assert.equal(result.windows[2].used,20);assert.equal(result.windows[2].limit,100);assert.equal(result.windows[0].resetAt,1893456000);
  assert.equal(source.parse({data:{balance:' ',credits:false}},cfg).supported,false);
  assert.equal(source.parse({data:{week:101}},cfg).supported,false);
  let count=0,authorization='';
  const server=http.createServer((req,res)=>{count++;authorization=req.headers.authorization||'';res.setHeader('content-type','application/json');setTimeout(()=>res.end(JSON.stringify(payload)),15);});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const provider={id:'quota-fixture',name:'Wallet fixture',agent:'builtin',apiKey:'secret-fixture',quotaApi:{...cfg,auth:'bearer',url:'http://127.0.0.1:'+server.address().port+'/usage'}};
    const providers=[provider];
    const [a,b]=await Promise.all([quota.one(providers,provider.id),quota.one(providers,provider.id)]);
    assert.equal(count,1);assert.deepEqual(a.item,b.item);
    assert.equal(a.item.metrics[0].remaining,38.5);assert.equal(a.item.windows[2].unit,'次');
    assert.equal(authorization,'Bearer secret-fixture');
    assert(!JSON.stringify(a).includes('secret-fixture'));assert(!JSON.stringify(a).includes('must-not-be-returned'));
    await quota.one(providers,provider.id);assert.equal(count,1,'five minute cache');
    await quota.one(providers,provider.id,true);assert.equal(count,2,'explicit refresh');
    provider.quotaApi.token='changed-secret';
    await quota.one(providers,provider.id);assert.equal(count,3,'config changes invalidate cached balance');assert.equal(authorization,'Bearer changed-secret');
    payload={data:{week:0}};provider.quotaApi.auth='none';provider.apiKey='';
    const all=await quota.all(providers,true);assert.equal(all.items.length,1);assert.equal(all.items[0].windows[0].remainingPercent,0);assert.equal(authorization,'');
    const mini={name:'MiniMax fixture',baseUrl:'http://127.0.0.1:'+server.address().port+'/anthropic',apiKey:'minimax-fixture-secret'};
    payload={base_resp:{status_code:0},model_remains:[{model_name:'general',current_interval_remaining_percent:1,current_interval_status:1,current_weekly_remaining_percent:100,current_weekly_status:3}]};
    let plan=await require('../../lib/balance').checkBalance(mini);assert.equal(plan.windows.length,1);assert.equal(plan.windows[0].remainingPercent,1);
    payload.model_remains[0].current_interval_status=2;plan=await require('../../lib/balance').checkBalance(mini);assert.equal(plan.windows[0].remainingPercent,0);
    payload.base_resp.status_code=2049;const before=count;plan=await require('../../lib/balance').checkBalance(mini);assert.equal(plan.supported,false);assert(plan.reason.includes('2049'));assert(!plan.reason.includes(mini.apiKey));assert.equal(count,before+1,'an API refusal is not retried against other domains');
    console.log('provider-quota: balances, credits, 5h/week/month, unknowns, auth, caching and coalescing passed');
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
};
