const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async function({api,ev,waitFor,browser,provider,quotaUrl}){
  const action=code=>ev('(async()=>{'+code+'})()');
  const config={type:'json',url:quotaUrl,auth:'bearer',token:'quota-ui-secret',metrics:[
    {label:'余额',kind:'balance',valuePath:'data.balance',unit:'CNY'},
    {label:'积分',kind:'credits',valuePath:'data.credits',unit:'积分'},
    {label:'5 小时',kind:'window',basis:'usedPercent',valuePath:'data.five',windowSeconds:18000,resetPath:'data.reset'},
    {label:'每周',kind:'window',basis:'remainingPercent',valuePath:'data.week',windowSeconds:604800},
    {label:'每月',kind:'window',basis:'used',valuePath:'data.month.used',limitPath:'data.month.limit',windowSeconds:2592000,unit:'次'},
  ]};
  const saved=await api('/api/providers/'+provider.id,'PUT',{name:'Workspace API',quotaApi:config});
  assert.equal(saved.quotaApi.token,'***');assert.equal(saved.quotaApi.metrics.length,5);
  await action(`closeDlg();await refreshData();window.AgentHubAgentCenter.close();await window.AgentHubModelCenter.open('connections');true`);
  await waitFor(()=>ev(`document.querySelector('[data-provider-quota=${JSON.stringify(provider.id)}]')?.textContent.includes('¥38.5')`),'provider card balance');
  await action(`document.querySelector('[data-provider-id=${JSON.stringify(provider.id)}] [data-provider-open]').click();true`);
  await waitFor(()=>ev(`document.querySelector('#mcProviderQuota')?.textContent.includes('每月')`),'provider quota panel');
  const panel=await ev(`(()=>{const el=document.getElementById('mcProviderQuota');return {text:el.innerText,meters:[...el.querySelectorAll('[role=meter]')].map(e=>Number(e.getAttribute('aria-valuenow'))),overflow:el.scrollWidth>el.clientWidth+1};})()`);
  assert.deepEqual(panel.meters,[62,65,75]);for(const text of ['余额','¥38.5','积分','1,500','5 小时','每周','每月','250 次','1,000 次'])assert(panel.text.includes(text),text);assert(!panel.overflow);
  if(process.env.ORBITCELL_UPDATE_PREVIEWS==='1'){
    const shot=await browser('screenshot');
    fs.copyFileSync(shot.path,path.resolve(__dirname,'../../docs/assets/orbitcell-providers.png'));
  }
  await action(`document.querySelector('#mcProviderQuota [data-pq-settings]').click();true`);
  assert(await ev(`(()=>{const type=document.getElementById('pqType');type.value='auto';type.onchange();type.syncControl?.();return document.getElementById('pqSettings').checkValidity()&&document.getElementById('pqCustom').hidden;})()`),'hidden custom fields do not prevent auto mode from saving');
  await action(`const type=document.getElementById('pqType');type.value='json';type.onchange();type.syncControl?.();document.getElementById('pqSave').click();true`);
  await waitFor(()=>ev(`!!document.getElementById('pqDialogPanel')&&document.getElementById('pqDialogPanel').textContent.includes('每周')`),'quota settings save and read');
  const roundtrip=await api('/api/providers?agent=all');
  const actual=roundtrip.find(p=>p.id===provider.id);assert.equal(actual.quotaApi.hasToken,true);assert.equal(actual.quotaApi.metrics.length,5);
  const session=await api('/api/sessions','POST',{agent:'builtin',providerId:provider.id,model:'fixture-model',title:'Quota preview'});
  await action(`closeDlg();window.AgentHubManagement.close();await refreshData();await openSession(${JSON.stringify(session.id)});true`);
  await waitFor(()=>ev(`document.getElementById('quotaChip')?.textContent.includes('¥38.5')`),'conversation quota chip');
  assert(await ev(`(()=>{const el=document.getElementById('quotaChip');return getComputedStyle(el).display!=='none'&&el.querySelector('button').getAttribute('aria-label').includes('Workspace API');})()`));
  await action(`document.querySelector('#quotaChip button').click();true`);
  await waitFor(()=>ev(`document.getElementById('pqDialogPanel')?.textContent.includes('5 小时')`),'conversation quota detail');
  await action(`closeDlg();window.AgentHubManagement.close();await window.AgentHubAgentCenter.open();document.querySelector('.ac-overview-link').click();document.querySelector('[data-ac-filter=all]').click();true`);
  await waitFor(()=>ev(`document.querySelectorAll('.ac-agent-card').length>=6`),'compact agent cards');
  const cards=await ev(`(()=>{const cards=[...document.querySelectorAll('.ac-agent-card')].slice(0,3);return cards.map(c=>{const r=c.getBoundingClientRect(),g=c.querySelector('.ac-card-settings').getBoundingClientRect();return {height:r.height,width:r.width,inset:g.top-r.top,right:r.right-g.right};});})()`);
  assert(cards.every(c=>c.height<=150&&c.width<=320),JSON.stringify(cards));assert(Math.max(...cards.map(c=>c.inset))-Math.min(...cards.map(c=>c.inset))<1,JSON.stringify(cards));
  if(process.env.ORBITCELL_UPDATE_PREVIEWS==='1'){
    const shot=await browser('screenshot');
    fs.copyFileSync(shot.path,path.resolve(__dirname,'../../docs/assets/orbitcell-agents.png'));
  }
  console.log('  PASS provider balances, credits, 5h/week/month, settings round trip, conversation quota and compact aligned cards');
};
