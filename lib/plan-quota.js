// Vendor-declared subscription windows. Do not infer a full allowance from an
// absent number, or add unrelated accounts/units together.
const { number } = require('./quota-source');
const quotaSession='ses_'+require('node:crypto').randomBytes(16).toString('hex');
const reset = value => {
  const n = number(value);
  if (n != null && n > 0) return Math.round(n > 1e12 ? n / 1000 : n);
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? Math.round(t / 1000) : null;
};
function source(provider) {
  let u; try { u = new URL(provider.baseUrl); } catch { return null; }
  if (['open.bigmodel.cn', 'api.z.ai'].includes(u.hostname)) return { kind:'zhipu-plan', url:u.origin+'/api/monitor/usage/quota/limit', rawAuth:true };
  if (['api.kimi.com', 'api.kimi.ai'].includes(u.hostname) && /\/coding(?:\/|$)/.test(u.pathname)) return { kind:'kimi-code', url:u.origin+'/coding/v1/usages' };
  if (u.hostname==='opencode.ai' && /\/zen\/go(?:\/|$)/.test(u.pathname)) return { kind:'opencode-go', url:u.origin+'/zen/go/v1/usage' };
  return null;
}
function window(id, label, usedPercent, seconds, at, extra={}) {
  const used=number(usedPercent);
  if (used==null || used<0 || used>100) return null;
  return { id, label, usedPercent:used, remainingPercent:100-used, limitWindowSeconds:seconds||null, resetAt:reset(at), ...extra };
}
function countWindow(id,label,row,seconds) {
  if (!row || typeof row!=='object') return null;
  const limit=number(row.limit),used=number(row.used),remaining=number(row.remaining);
  if (!(limit>0) || (used==null && remaining==null)) return null;
  const consumed=used==null?Math.max(0,limit-remaining):used;
  return window(id,label,Math.max(0,Math.min(100,consumed/limit*100)),seconds,row.resetTime??row.resetAt??row.reset_at??row.reset_time,
    {used:consumed,remaining:remaining??Math.max(0,limit-consumed),limit,unit:String(row.unit||'')});
}
function label(seconds) {
  if (seconds===2592000) return '每月';
  if (seconds===604800) return '每周';
  if (seconds===86400) return '每日';
  if (seconds>0&&seconds%86400===0) return seconds/86400+' 天';
  if (seconds>0&&seconds%3600===0) return seconds/3600+' 小时';
  return seconds>0?Math.round(seconds/60)+' 分钟':'额度窗口';
}
function parse(kind,body) {
  const windows=[];
  if (kind==='zhipu-plan' && body?.success!==false) {
    for (const [i,row] of (Array.isArray(body?.data?.limits)?body.data.limits:[]).entries()) {
      const seconds=row.type==='TIME_LIMIT'?2592000:Number(row.unit)===6?604800:Number(row.unit)===3?(Number(row.number)>0?Number(row.number):5)*3600:0;
      const w=window('zhipu-'+i,row.type==='TIME_LIMIT'?'MCP · 每月':label(seconds),row.percentage,seconds,row.nextResetTime);
      if(w)windows.push(w);
    }
  }
  if (kind==='opencode-go') {
    for(const [key,seconds]of [['rolling',18000],['weekly',604800],['monthly',2592000]]){
      const row=body?.usage?.[key];
      const w=window(key,label(seconds),row?.percent,seconds,number(row?.percent)>0?row.resetsAt:null);
      if(w)windows.push(w);
    }
  }
  if (kind==='kimi-code') {
    for (const [i,item] of (Array.isArray(body?.limits)?body.limits:[]).entries()) {
      const n=number(item.window?.duration)||0,unit=String(item.window?.timeUnit||'');
      const seconds=n*(unit.includes('MINUTE')?60:unit.includes('HOUR')?3600:unit.includes('DAY')?86400:unit.includes('WEEK')?604800:unit.includes('MONTH')?2592000:0);
      const w=countWindow('kimi-'+i,label(seconds),item.detail||item.window,seconds);if(w)windows.push(w);
    }
    const week=countWindow('kimi-week','每周',body?.usage,604800);if(week)windows.push(week);
    const shares=new Set();
    for (const [key,seconds] of [['limit_5h',18000],['limit_7d',604800],['limit_month_total',2592000],['limit_month_code',2592000]]) {
      const row=body?.usages?.[key]||body?.usages?.[key.replace(/_([a-z0-9])/g,(_,c)=>c.toUpperCase())];
      const ratio=number(row?.used_ratio??row?.usedRatio);
      const w=window('kimi-'+key,label(seconds),ratio==null?null:ratio*100,seconds,row?.resetTime??row?.resetAt??row?.reset_at);
      if(w&&!shares.has(seconds)){shares.add(seconds);const old=windows.findIndex(x=>x.limitWindowSeconds===seconds);if(old>=0)windows.splice(old,1);windows.push(w);}
    }
    windows.sort((a,b)=>(a.limitWindowSeconds||Infinity)-(b.limitWindowSeconds||Infinity));
  }
  if(!windows.length)return {supported:false,reason:'供应商未返回可读取的套餐用量；请检查此密钥是否支持额度查询'};
  return {supported:true,kind,planType:typeof body?.data?.level==='string'?body.data.level:'',windows};
}
async function query(provider, spec, fetchJson) {
  const key=String(provider.apiKey||'');
  if(!key)return {supported:false,reason:'缺少套餐查询密钥'};
  const headers={Authorization:spec.rawAuth?key:'Bearer '+key,Accept:'application/json'};
  if(spec.kind==='opencode-go'){headers['x-opencode-session']=quotaSession;headers['x-opencode-session-id']=quotaSession;}
  const result=await fetchJson(spec.url,{headers,redirect:'error'},10000);
  if(!result.ok||!result.json)return {supported:false,reason:'套餐额度接口 HTTP '+result.status};
  return parse(spec.kind,result.json);
}
module.exports={source,parse,query};
