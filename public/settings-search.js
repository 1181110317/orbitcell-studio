/* Search labels across the existing settings DOM; never index input values. */
window.AgentHubSettingsSearch=(()=>{
  function mount(root){
    const content=root.querySelector('.settings-content');if(!content||root.querySelector('[data-settings-search]'))return;
    const bar=document.createElement('div');bar.className='settings-global-search';
    bar.innerHTML='<label><span aria-hidden="true">'+window.AgentHubIcons.svg('search')+'</span><input type="search" data-settings-search data-settings-local="1" aria-label="搜索全部设置" placeholder="搜索全部设置，例如：缓存、终端、快捷键"></label><button type="button" class="btn-mini" aria-label="清空设置搜索" hidden>清空</button>';
    const results=document.createElement('section');results.className='settings-search-results';results.hidden=true;results.setAttribute('aria-label','全部设置搜索结果');content.prepend(bar,results);
    const field=bar.querySelector('input'),clearButton=bar.querySelector('button'),panes=[...content.querySelectorAll('.settings-pane')],entries=[],seen=new Set();let timer;
    for(const pane of panes)for(const control of pane.querySelectorAll('input:not([type=hidden]),select,textarea')){
      if(control.matches('[data-conversation-search]'))continue;
      const row=control.closest('[data-conversation-item],.fld,.settings-pref-row,label')||control.parentElement;if(!row||seen.has(row))continue;seen.add(row);
      const original=row.querySelector('b,label'),source=(node,omit='')=>window.AgentHubLocale?.sourceText(node,omit)??node?.textContent??'';
      const name=(original?source(original):control.getAttribute('aria-label')||source(row,'input,select,textarea,button')).trim().replace(/\s+/g,' '),description=source(row.querySelector('small')).trim();
      if(name)entries.push({pane,row,control,name:name.slice(0,150),description,section:source(pane.querySelector('h4'))||'设置',text:(name+' '+description).toLocaleLowerCase()});
    }
    const current=()=>root.querySelector('[data-settings-jump].active')?.dataset.settingsJump+'-panel';
    const clear=()=>{clearTimeout(timer);field.value='';clearButton.hidden=true;results.hidden=true;for(const pane of panes)pane.hidden=pane.id!==current();};
    const open=item=>{
      clear();root.querySelector(`[data-settings-jump="${item.pane.id.replace(/-panel$/,'')}"]`)?.click();
      const local=root.querySelector('[data-conversation-search]');if(local?.value){local.value='';local.dispatchEvent(new Event('input',{bubbles:true}));}
      const group=item.row.closest('[data-conversation-pane]');if(group)root.querySelector(`[data-conversation-tab="${group.dataset.conversationPane}"]`)?.click();
      item.row.scrollIntoView({block:'center'});const focus=item.row.querySelector('.select-control,button,input,textarea,select');focus?.focus({preventScroll:true});
    };
    const draw=()=>{
      const query=field.value.trim().toLocaleLowerCase();if(!query){clear();return;}clearButton.hidden=false;panes.forEach(p=>p.hidden=true);results.hidden=false;
      const hits=entries.filter(e=>{const translated=window.AgentHubLocale?.translate(e.name+' '+e.description)||'';const section=window.AgentHubLocale?.translate(e.section)||e.section;const haystack=(e.text+' '+e.section+' '+translated+' '+section+' '+(window.AgentHubLocale?.translate(e.name)||'')+' '+(window.AgentHubLocale?.translate(e.description)||'')).toLocaleLowerCase();return query.split(/\s+/).every(word=>haystack.includes(word));});
      results.replaceChildren();const heading=document.createElement('p');heading.className='dialog-note';heading.textContent=`全部设置 · ${hits.length} 项结果`;results.append(heading);
      if(!hits.length){const empty=document.createElement('p');empty.textContent='没有匹配的设置，试试“缓存”“字体”或“终端”。';results.append(empty);}
      for(const item of hits){const button=document.createElement('button');button.type='button';button.className='settings-search-hit';const title=document.createElement('b'),path=document.createElement('small');title.textContent=item.name;path.textContent=item.section+(item.description?' · '+item.description:'');button.append(title,path);button.onclick=()=>open(item);results.append(button);}
    };
    field.oninput=()=>{clearTimeout(timer);timer=setTimeout(draw,100);};clearButton.onclick=()=>{clear();field.focus();};field.onkeydown=e=>{if(e.key==='Escape'&&field.value){e.preventDefault();e.stopPropagation();clear();}};
    root.addEventListener('click',e=>{if(e.target.closest('[data-settings-jump]')&&field.value)clear();},true);
  }
  return {mount};
})();
