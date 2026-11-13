/* Reading preferences affect this Agent only and never change runtime access. */
(() => {
  'use strict';
  const fields=[['contentWidth','内容宽度',[['normal','标准'],['wide','宽'],['full','铺满']]],['runningDepth','运行时展开',[['0','收起过程'],['1','展开过程'],['2','展开工具组'],['3','展开工具详情']]],['historyDepth','历史记录展开',[['0','收起过程'],['1','展开过程'],['2','展开工具组'],['3','展开工具详情']]],['completedDepth','完成后展开',[['0','收起过程'],['1','展开过程'],['2','展开工具组'],['3','展开工具详情'],['keep','保持当前']]],['replyActions','回答操作栏',[['always','始终显示'],['hover','悬停显示']]],['sendKey','发送快捷键',[['enter','Enter'],['mod-enter','Ctrl / ⌘ + Enter']]]];
  const toggles=[['followOutput','跟随流式输出'],['showToolTiming','显示工具耗时'],['showToolCounts','显示工具计数'],['showReplyModel','显示回答模型'],['showPlanStrip','显示计划进度'],['showDiagnostics','显示启动诊断']];
  function render(root,agent){
    const prefs=window.AgentHubConversationPreferences,value=prefs.read(agent);
    root.innerHTML=`<div class="ac-page-intro"><h3>页面偏好</h3><p>仅用于此 Agent 的会话页面，保存在当前浏览器。</p></div><form class="ac-form ac-appearance-form"><div class="ac-field-pair">${fields.map(([key,label,choices])=>`<div class="fld"><label for="ap-${key}">${label}</label><select id="ap-${key}" data-appearance="${key}">${choices.map(([id,name])=>`<option value="${id}" ${value[key]===id?'selected':''}>${name}</option>`).join('')}</select></div>`).join('')}</div><div class="ac-appearance-toggles">${toggles.map(([key,label])=>`<label><span>${label}</span><input type="checkbox" data-appearance="${key}" ${value[key]?'checked':''}></label>`).join('')}</div><div class="ac-save-bar"><span id="apStatus" role="status">不改变字体、字号或缩进。</span><button type="button" class="btn ghost" data-appearance-reset>恢复全局偏好</button><button type="submit" class="btn">保存页面偏好</button></div></form>`;
    enhanceDialogSelects(root);
    root.querySelector('form').onsubmit=event=>{event.preventDefault();try{const patch=Object.fromEntries([...root.querySelectorAll('[data-appearance]')].map(n=>[n.dataset.appearance,n.type==='checkbox'?n.checked:n.value]));prefs.saveAgent(agent,patch);applyViewPreferences();if(S.curAgent===agent)renderMessages();root.querySelector('#apStatus').textContent='已保存此 Agent 的页面偏好';}catch(error){root.querySelector('#apStatus').textContent=error.message;}};
    root.querySelector('[data-appearance-reset]').onclick=()=>{try{prefs.saveAgent(agent,null);render(root,agent);applyViewPreferences();if(S.curAgent===agent)renderMessages();}catch(error){toast(error.message,'err');}};
  }
  window.AgentHubAgentPagePreferences=Object.freeze({render});
})();
