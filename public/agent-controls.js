/* Values are the existing transport contract; labels describe each adapter's
   actual behavior. ACP modes are supplied by its runtime, never invented here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AgentHubAgentControls=api;})(typeof window==='object'?window:this,()=>{
  'use strict';
  const row=(value,label,description,icon,nativeValue)=>({value,label,description,icon,nativeValue});
  function modes(agent,{features={},remote=false}={}){
    if(agent==='dsh')return [row('default','Agent 默认','使用 DSH 当前 Profile 的权限设置','permissionDefault','default'),row('read-only','只读','DSH 原生只读预设','permissionRead','read-only'),row('workspace-write','工作区写入','DSH 原生工作区读写与命令执行','permissionWorkspace','workspace-write'),row('danger-full-access','完全访问','DSH 原生无限制访问预设','permissionFull','danger-full-access')];
    if(agent==='codex')return [row('auto','完全访问','关闭沙箱与审批限制','permissionFull','danger-full-access'),row('plan','只读','Codex 原生 read-only 沙箱','permissionRead','read-only'),row('ask','工作区写入','workspace-write 沙箱；原生桥按需审批，兼容通道拒绝越界操作','permissionWorkspace','workspace-write')];
    if(agent==='zcode')return [row('auto','自动执行','ZCode 原生 yolo 模式','permissionFull','yolo'),row('edits','编辑模式','ZCode 原生 edit 模式','permissionEdit','edit'),row('plan','计划模式','ZCode 原生 plan 模式','permissionPlan','plan'),row('ask','构建模式','ZCode 原生 build 模式，按需确认','permissionAsk','build')];
    if(agent==='builtin')return [row('auto','自动执行','OrbitCell 直接执行可用工具','permissionFull','auto'),row('edits','允许编辑','自动批准文件编辑；命令执行不开放','permissionEdit','edits'),row('plan','只读模式','只允许读取和检索工具','permissionRead','plan'),row('ask','逐次确认','编辑、命令等操作在页面中确认','permissionAsk','ask')];
    return [row('auto','完全访问','跳过全部确认，允许编辑与命令','permissionFull','bypassPermissions'),...((features.permMode!==false||remote)?[row('edits','接受编辑','原生 acceptEdits；其他操作按需确认','permissionEdit','acceptEdits'),row('plan','计划模式','原生 plan；调研与规划','permissionPlan','plan')]:[]),row('ask','默认确认','原生默认审批；兼容通道无法确认时拒绝操作','permissionAsk','default')];
  }
  function nativeControls(data={}){
    const config=(data.configOptions||[]).find(o=>o.category==='mode');
    if(config)return {field:'acpConfig',id:config.id,label:config.name||'原生模式',current:config.currentValue||'',options:(config.options||[]).flatMap(o=>o.options||[o]).map(o=>({value:o.value,label:o.name||o.value,description:o.description||''}))};
    return {field:'acpMode',id:'',label:'原生模式',current:data.modes?.currentModeId||'',options:(data.modes?.availableModes||[]).map(o=>({value:o.id,label:o.name||o.id,description:o.description||''}))};
  }
  return Object.freeze({modes,nativeControls});
});
