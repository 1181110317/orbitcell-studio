// Browser checks for theme persistence, composer controls and async UI operations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-workspace-ui-'));
const BASE = 'http://127.0.0.1:18951';
fs.writeFileSync(path.join(DATA, 'providers.json'), JSON.stringify({ list: [], meta: { ccswitchImportDone: true } }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
async function api(route, method = 'GET', body) {
  const r = await fetch(BASE + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(route === '/api/browser/open' ? 90000 : 35000) });
  const data = await r.json();
  assert(r.ok, `${method} ${route}: ${r.status} ${JSON.stringify(data).slice(0, 1200)}`);
  return data;
}
const browser = (route, body = {}) => api('/api/browser/' + route, 'POST', body);
async function evaluate(expression) { const r = await browser('evaluate', { expression }); assert(r.ok, r.error); return r.value; }
async function waitFor(fn, label) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) { try { if (await fn()) return; } catch {} await sleep(120); }
  throw new Error('Timed out: ' + label);
}
async function ready() { await waitFor(() => evaluate('typeof S!=="undefined" && S.wsReady && S.agents.length>0'), 'browser startup'); }
async function delayed(route, method, action) {
  return evaluate(`(async()=>{const original=window.fetch;window.fetch=async(...args)=>{
    const r=await original(...args);if(String(args[0]).startsWith(${JSON.stringify(route)})&&(args[1]?.method||'GET')===${JSON.stringify(method)})await new Promise(resolve=>setTimeout(resolve,400));return r;
  };try{${action}}finally{window.fetch=original;}})()`);
}
(async () => {
  try {
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, windowsHide: true, stdio: 'ignore', env: { ...process.env, AGENTHUB_PORT: '18951', AGENTHUB_HOST: '127.0.0.1', AGENTHUB_DATA_DIR: DATA, AGENTHUB_TOKEN: '', AGENTHUB_RO_TOKEN: '' } });
    await waitFor(() => api('/api/health'), 'server startup');
    if (!(await api('/api/browser/status')).browser) { console.log('[workspace-ui] skipped: Chrome/Edge unavailable'); return; }
    const session = await api('/api/sessions', 'POST', { agent: 'builtin', autoPerms: true, permMode: 'auto' });
    await browser('open', { url: BASE }); await ready(); await evaluate(`openSession(${JSON.stringify(session.id)})`);
    const projectIndent = await evaluate(`(()=>{const head=document.querySelector('#sessionList .proj-head:not(.shelf-head) .proj-name');const title=document.querySelector('#sessionList .session-item.project-child .si-title');return head&&title?{head:Math.round(head.getBoundingClientRect().x),child:Math.round(title.getBoundingClientRect().x)}:null})()`);
    assert(projectIndent, 'project session fixture must render a project and child row');
    assert(Math.abs(projectIndent.head - projectIndent.child) <= 1, `project child title must align with project name: ${JSON.stringify(projectIndent)}`);
    console.log('  ✓ project child titles align under the project name');
    const runningState = await evaluate(`(()=>{
      S.running.add(${JSON.stringify(session.id)});renderSessions();
      const row=document.querySelector('.session-item[data-sid="${session.id}"]');
      const state={marker:!!row?.querySelector('.si-run'),label:row?.querySelector('.si-time')?.textContent};
      S.running.delete(${JSON.stringify(session.id)});renderSessions();
      return state;
    })()`);
    assert.deepEqual(runningState, { marker: true, label: '运行中' }, 'running sessions should show a marker and status label');
    console.log('  ✓ running sessions are marked in the project list');
    const themes = await evaluate(`(()=>{
      openThemeMenu();const rows=[];const probe=document.createElement('span');document.body.append(probe);
      const rgb=value=>{probe.style.color=value;return getComputedStyle(probe).color.match(/[0-9.]+/g).slice(0,3).map(Number);};
      const luminance=values=>values.map(v=>{v/=255;return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=luminance(rgb(a)),y=luminance(rgb(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const original=window.mermaid;let diagramTheme;window.mermaid={initialize:opts=>diagramTheme=opts.theme};
      try {for(const t of THEMES){document.querySelector('[data-settings-theme="'+t.id+'"]').click();rows.push({id:t.id,selected:document.body.dataset.theme,pressed:document.querySelector('[data-settings-theme="'+t.id+'"]').getAttribute('aria-pressed'),dark:document.body.dataset.colorMode,diagram:diagramTheme,expectedDark:!!t.dark,text:contrast('var(--text)','var(--bg)'),muted:contrast('var(--muted)','var(--panel)'),button:contrast('var(--accent-contrast)','var(--accent)')});}}
      finally{probe.remove();window.mermaid=original;closeDlg();}return rows;
    })()`);
    assert.equal(themes.length, 11);
    for (const t of themes) {
      assert.equal(t.selected, t.id); assert.equal(t.pressed, 'true');
      assert.equal(t.dark, t.expectedDark ? 'dark' : 'light');
      assert.equal(t.diagram, t.expectedDark ? 'dark' : 'default');
      for (const key of ['text', 'muted', 'button']) assert(t[key] >= 4.5, `${t.id} ${key} contrast ${t[key]}`);
    }
    console.log('  ✓ 11 theme choices, diagram modes and text/button contrast');

    await evaluate(`applyTheme('ocean');document.getElementById('pillModel').click();true`);
    assert.equal(await evaluate(`!document.getElementById('flyMenu').classList.contains('hidden')&&!!document.querySelector('[data-model-defaults]')`),true);
    await browser('open', { url: BASE }); await ready();
    assert.deepEqual(await evaluate(`({theme:document.body.dataset.theme,independentConfig:!!document.getElementById('btnComposerConfig'),model:getComputedStyle(document.getElementById('pillModel')).display!=='none'})`),{theme:'ocean',independentConfig:false,model:true});
    console.log('  ✓ theme persists and model settings remain available from the composer');

    await evaluate(`installCustomTheme({vars:{'--accent':'#175f70','--bg':'#fafaf7'}});applyTheme('custom');true`);
    await browser('open', { url: BASE }); await ready();
    const custom = await evaluate(`({theme:document.body.dataset.theme,color:getComputedStyle(document.body).getPropertyValue('--accent').trim(),exported:collectThemeVars('custom')['--accent'],registered:THEMES.some(t=>t.id==='custom')})`);
    assert.deepEqual(custom, { theme: 'custom', color: '#175f70', exported: '#175f70', registered: true });
    assert.equal(await evaluate(`(()=>{try{installCustomTheme({vars:{'--bg':'white;}body{display:none'}});return false;}catch{return true;}})()`), true);
    console.log('  ✓ custom theme survives reload and remains exportable; invalid CSS rejected');

    const lateDialogs = [
      ['/api/providers', 'showProviders(true)', 'showSettings()', '设置'],
      ['/api/ssh/hosts', 'showSSH()', 'showSettings()', '设置'],
      ['/api/usage', 'showStats()', 'showSettings()', '设置'],
    ];
    for (const [route, first, next, expected] of lateDialogs) {
      const title = await delayed(route, 'GET', `closeDlg();const pending=${first};await ${next};await pending;return document.getElementById('dlgTitle').textContent;`);
      assert.equal(title, expected, first + ' must not overwrite next dialog');
    }
    console.log('  ✓ providers, SSH and usage ignore late responses');
    const legacyRead=await evaluate(`(async()=>{const original=window.fetch;let requested=false;window.fetch=(url,options)=>{if(String(url).startsWith('/api/ccswitch'))requested=true;return original(url,options);};try{await showSettings();return requested;}finally{window.fetch=original;}})()`);assert.equal(legacyRead,false);
    console.log('  ✓ settings no longer reads an external cc-switch database');

    await evaluate(`(async()=>{closeDlg();const original=window.fetch;window.fetch=(url,options)=>String(url).startsWith('/api/providers')?Promise.resolve(new Response(JSON.stringify({error:'fixture unavailable'}),{status:503,headers:{'content-type':'application/json'}})):original(url,options);try{await showProviders(true);}finally{window.fetch=original;}})()`);
    assert.equal(await evaluate(`!!document.getElementById('dialogLoadRetry')&&document.getElementById('dlgBody').textContent.includes('fixture unavailable')`), true);
    await evaluate(`document.getElementById('dialogLoadRetry').onclick()`);
    assert.equal(await evaluate(`!!document.getElementById('npSave')`), true);
    console.log('  ✓ dialog load failure offers a working retry');

    const point = await evaluate(`(async()=>{await ensureEcharts();openDlg('趋势检查','<div id="chTrend" style="width:400px;height:240px"></div>');drawTrendChart([{date:'2026-09-20',models:{fixture:1920}}],['fixture']);await new Promise(resolve=>setTimeout(resolve,400));const graphic=S.charts.trend.getModel().getSeriesByIndex(0).getData().getItemGraphicEl(0);const result={visible:!!graphic&&!graphic.ignore,width:graphic?graphic.getBoundingRect().width:0};closeDlg();return result;})()`);
    assert.equal(point.visible, true); assert(point.width > 0, 'single-day trend has a visible marker');
    console.log('  ✓ a single day of usage renders a visible trend point');

    const count = (await api('/api/sessions')).length;
    const picker = await evaluate(`(async()=>{closeDlg();await openSession(${JSON.stringify(session.id)});newTaskInContext();newTaskInContext();const menus=document.querySelectorAll('.new-task-chooser').length;await document.querySelector('[data-task-agent="builtin"]').onclick();return {menus,agent:S.curAgent,session:S.curSessionId};})()`);
    assert.deepEqual(picker,{menus:1,agent:'builtin',session:null});
    assert.equal((await api('/api/sessions')).length, count);
    await delayed('/api/sessions', 'POST', `const pending=newSession();newSession();await pending;`);
    assert.equal((await api('/api/sessions')).length, count + 1);
    console.log('  ✓ repeated new-task opens one chooser; repeated session creation saves one record');

    const boundaries = await evaluate(`(()=>{
      const fixture=document.createElement('div');fixture.className='msg msg-assistant';
      fixture.innerHTML='<div class="turn"><div class="turn-timeline">'+activityHtml(Array.from({length:3},(_,i)=>({type:'tool',id:'layout-command-'+i,name:'Bash',detail:JSON.stringify({command:'node --version'}),output:'v22',status:'done'})))+'<div class="turn-answer md-body"><p>检查完成。</p></div></div></div>';
      document.getElementById('messages').append(fixture);
      try{
        const activity=fixture.querySelector('.turn-activity'),process=fixture.querySelector('.turn-process'),group=fixture.querySelector('.tool-group'),body=group.querySelector('.tool-group-body'),answer=fixture.querySelector('.turn-answer'),timeline=fixture.querySelector('.turn-timeline');activity.open=true;
        const painted=color=>color!=='transparent'&&color!=='rgba(0, 0, 0, 0)';
        const font=node=>{const s=getComputedStyle(node);return [s.fontFamily,s.fontSize,s.lineHeight];};
        return [false,true].map(open=>{
          activity.classList.toggle('activity-live',open);group.querySelectorAll('.step-tool').forEach(node=>node.dataset.state=open?'running':'done');
          group.open=open;const low=group.querySelector('summary').getBoundingClientRect().bottom,high=answer.getBoundingClientRect().top;
          const edges=[group,process,activity,timeline].filter(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return r.height>0&&r.bottom>=low-1&&r.bottom<=high+1&&parseFloat(s.borderBottomWidth)>0&&s.borderBottomStyle!=='none'&&painted(s.borderBottomColor);}).length;
          const separator=getComputedStyle(answer,'::before'),separatorY=high+(parseFloat(separator.top)||0),line=separator.content!=='none'&&separator.content!=='normal'&&parseFloat(separator.height)>0&&painted(separator.backgroundColor)&&separatorY>=low-1&&separatorY<=high+1;
          const rails=[activity,process,group,body].filter(node=>{const s=getComputedStyle(node);return node.getBoundingClientRect().height>0&&parseFloat(s.borderLeftWidth)>0&&s.borderLeftStyle!=='none'&&painted(s.borderLeftColor);}).length;
          const indent=open?Math.max(Math.abs(body.getBoundingClientRect().left-group.getBoundingClientRect().left),Math.abs(group.querySelector('.step-head').getBoundingClientRect().left-group.getBoundingClientRect().left)):0;
          return {boundaries:edges+Number(line),rails,indent,textFont:font(answer),toolFonts:[group.querySelector('summary'),group.querySelector('.step-head'),group.querySelector('.step-title'),group.querySelector('.st-sum')].filter(Boolean).map(font)};
        });
      }finally{fixture.remove();}
    })()`);
    for(const view of boundaries){assert.equal(view.boundaries,1,'expanded and collapsed tools have one boundary before the answer');assert.equal(view.rails,0,'tool calls keep their original layout without an added execution rail');assert(view.indent<1,'expanded tool rows keep their original alignment without an added indent');for(const font of view.toolFonts)assert.deepEqual(font,view.textFont,'history and running tool calls retain the configured conversation font, size and line height');}
    console.log('  ✓ running and history tools retain original typography and alignment with one answer separator');

    const sectionLayout=await evaluate(`(()=>{
      const fixture=document.createElement('div');fixture.id='tool-boundary-fixture';fixture.className='msg msg-assistant';
      const command={type:'tool',name:'Bash',detail:JSON.stringify({command:'node --version'}),output:'v22',status:'done'};
      fixture.innerHTML='<div class="turn"><div class="turn-timeline">'+activityHtml([command,{type:'text',text:'换一种方式继续检查。'},{type:'tool',name:'Read',detail:JSON.stringify({file_path:'fixture.txt'}),output:'sample',status:'done'},command])+'<div class="turn-answer md-body"><p>检查完成。</p></div></div></div>';
      document.getElementById('messages').append(fixture);
      const style=document.createElement('style');
      try{
        fixture.querySelector('.turn-activity').open=true;fixture.querySelectorAll('.tool-group').forEach(group=>group.open=true);
        const process=fixture.querySelector('.turn-process'),group=process.querySelector('.tool-group'),description=group.querySelector('.tool-group-description').getBoundingClientRect(),caret=group.querySelector('.tool-group-chevron').getBoundingClientRect();
        const geometry=()=>[...fixture.querySelectorAll('.tool-group-summary,.step-head,.turn-commentary,.tool-group-breakdown,.turn-answer')].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,padding:s.padding,margin:s.margin};});
        const before=geometry(),sections=[...process.children].filter(node=>getComputedStyle(node,'::before').content!=='none').length;
        style.textContent='#messages #tool-boundary-fixture .turn-process>.tool-group+.turn-commentary::before,#messages #tool-boundary-fixture .turn-process>.turn-commentary+.tool-group::before{content:none!important}';document.head.append(style);
        return {sameGeometry:JSON.stringify(before)===JSON.stringify(geometry()),sections,inlineCaret:caret.left>=description.right&&caret.left-description.right<16};
      }finally{style.remove();fixture.remove();}
    })()`);
    assert.deepEqual(sectionLayout,{sameGeometry:true,sections:2,inlineCaret:true},'section borders preserve the original tool typography, spacing and inline disclosure layout');
    console.log('  ✓ tool and narrative boundaries preserve the original typography, spacing and inline caret');

    const permissionIcons=await evaluate(`(async()=>{
      const rows=[];
      for(const agent of ['claude','codex','dsh','builtin']){
        await switchAgent(agent);const select=document.getElementById('selPerm'),button=document.getElementById('pillPerm'),values=[...select.options].map(o=>o.value);
        for(let i=0;i<values.length;i++){
          button.click();const option=document.querySelectorAll('#flyMenu .fly-item')[i],menuIcon=option.querySelector('svg'),icon=menuIcon.dataset.icon,color=getComputedStyle(menuIcon).color,stroke=menuIcon.getAttribute('stroke-width'),size=menuIcon.getBoundingClientRect().width;
          option.click();await new Promise(requestAnimationFrame);await Promise.all(button.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));const selected=button.querySelector('.config-icon svg');
          rows.push({agent,expected:values[i],actual:select.value,icon,selectedIcon:selected.dataset.icon,color,selectedColor:getComputedStyle(selected).color,stroke,selectedStroke:selected.getAttribute('stroke-width'),size,selectedSize:selected.getBoundingClientRect().width});
        }
      }
      await openSession(${JSON.stringify(session.id)});return rows;
    })()`);
    assert(permissionIcons.length>=14);
    for(const item of permissionIcons){assert.equal(item.actual,item.expected);assert.equal(item.icon,item.selectedIcon);assert.equal(item.color,item.selectedColor,item.agent+'/'+item.expected+' icon colors');assert.equal(item.stroke,item.selectedStroke);assert(Math.abs(item.size-item.selectedSize)<1);}
    assert.equal((await api('/api/sessions/'+session.id)).permMode,'auto','presentation changes do not update the saved session permissions');
    console.log('  ✓ permission menu and composer share matching icons, colors and stroke weights across all modes');

    await evaluate(`(async()=>{await showProviders(true);document.getElementById('npAgent').value='builtin';document.getElementById('npName').value='UI fixture';document.getElementById('npBase').value='http://127.0.0.1:1/v1';document.getElementById('npKey').value='local-fixture-only';})()`);
    const failedSave = await evaluate(`(async()=>{const original=window.fetch;window.fetch=(url,options)=>String(url)==='/api/providers'&&options?.method==='POST'?Promise.resolve(new Response(JSON.stringify({error:'fixture save failed'}),{status:503,headers:{'content-type':'application/json'}})):original(url,options);try{const b=document.getElementById('npSave');await b.onclick();return {name:document.getElementById('npName').value,disabled:b.disabled,busy:b.hasAttribute('aria-busy')};}finally{window.fetch=original;}})()`);
    assert.deepEqual(failedSave, { name: 'UI fixture', disabled: false, busy: false });
    console.log('  ✓ failed provider save preserves input and permits retry');
    const providerTitle = await delayed('/api/providers', 'POST', `const b=document.getElementById('npSave');const pending=b.onclick();b.click();await showSettings();await pending;return document.getElementById('dlgTitle').textContent;`);
    assert.equal(providerTitle, '设置');
    assert.equal((await api('/api/providers?agent=all')).filter(p => p.name === 'UI fixture').length, 1);
    console.log('  ✓ provider submit deduplicates and respects navigation');

    await evaluate(`(async()=>{await showSSH();document.getElementById('shHost').value='127.0.0.1';document.getElementById('shPort').value='1';document.getElementById('shUser').value='qa';document.getElementById('shPass').value='local-fixture-only';})()`);
    const sshTitle = await delayed('/api/ssh/hosts', 'POST', `const b=document.getElementById('shSave');const pending=b.onclick();b.click();await showSettings();await pending;return document.getElementById('dlgTitle').textContent;`);
    assert.equal(sshTitle, '设置'); assert.equal((await api('/api/ssh/hosts')).length, 1);
    console.log('  ✓ SSH submit deduplicates without opening a connection');

    await evaluate('showSettings()');
    const saveTitle = await delayed('/api/settings', 'PUT', `const b=document.getElementById('setSave');const pending=b.onclick();b.click();await showProviders(true);await pending;return document.getElementById('dlgTitle').textContent;`);
    assert.equal(saveTitle, 'API 管理');
    console.log('  ✓ saving settings does not replace the next dialog');

    // Exercise real responsive viewports in a same-origin frame. Checking hit
    // targets catches overlays that look present but cannot actually be used.
    await evaluate(`(async()=>{
      closeDlg();const frame=document.createElement('iframe');frame.id='layoutFixture';
      frame.style.cssText='position:fixed;inset:0;z-index:10000;border:0;width:390px;height:844px';
      frame.src=location.origin;document.body.append(frame);
      await new Promise(resolve=>frame.onload=resolve);
    })()`);
    await waitFor(() => evaluate(`document.getElementById('layoutFixture').contentWindow.eval('typeof S!=="undefined"&&S.wsReady&&S.agents.length>0')`), 'responsive fixture startup');
    try {
      for (const [width, height] of [[320,640],[390,844],[740,390],[900,600],[1024,600],[1440,900]]) {
        const layout = await evaluate(`(async()=>{
          const frame=document.getElementById('layoutFixture');frame.style.width='${width}px';frame.style.height='${height}px';
          const w=frame.contentWindow,d=w.document;
          await w.openSession(${JSON.stringify(session.id)});w.toggleSidebar(false);
          d.querySelector('#pillModel .dd-value').textContent='vendor/reasoning-model-with-a-long-version-name';
          await new Promise(resolve=>setTimeout(resolve,250));
          const rect=id=>d.getElementById(id).getBoundingClientRect(),visible=id=>rect(id).width>0;
          const left=d.querySelector('.hdr-left').getBoundingClientRect(),right=d.querySelector('.hdr-right').getBoundingClientRect();
          const header={overlap:left.right>right.left+1,export:visible('btnExport'),usage:visible('hdrUsage'),more:visible('btnHeaderMore'),theme:visible('btnTheme')};
          const send=rect('btnSend'),attach=rect('btnAttach'),panel=d.querySelector('.composer-panel').getBoundingClientRect();
          const sendAligned=Math.abs(send.top+send.height/2-attach.top-attach.height/2)<3;
          w.toggleSidebar(true);
          const more=d.getElementById('agentMoreBtn');if(more?.getAttribute('aria-expanded')==='false')more.click();
          const section=d.querySelector('.side-section').getBoundingClientRect(),footer=d.querySelector('.side-footer').getBoundingClientRect();
          const footerOverlap=section.bottom>footer.top+1;
          const button=d.getElementById('btnSettings');button.scrollIntoView({block:'nearest'});
          await new Promise(resolve=>setTimeout(resolve,250));
          const b=button.getBoundingClientRect(),hit=d.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
          const footerReachable=button===hit||button.contains(hit);
          await w.showSettings('settings-cli');
          await new Promise(resolve=>setTimeout(resolve,250));
          const cli=d.querySelector('[data-bin]');cli.scrollIntoView({block:'nearest'});
          const c=cli.getBoundingClientRect(),target=d.elementFromPoint(c.x+c.width/2,c.y+c.height/2);
          const dialogReachable=cli===target||cli.contains(target);
          const save=rect('setSave');
          w.closeDlg();w.openNewTaskAgentChooser({hostId:'',cwd:''});
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const chooser=d.querySelector('.new-task-chooser'),context=chooser.querySelector('.new-task-context'),search=chooser.querySelector('.new-task-search'),list=chooser.querySelector('.new-task-agents'),taskFooter=chooser.querySelector('.new-task-footer');
          const contextBox=context.getBoundingClientRect(),searchBox=search.getBoundingClientRect(),listBox=list.getBoundingClientRect(),footerBox=taskFooter.getBoundingClientRect(),chooserBox=chooser.getBoundingClientRect();
          const task={separate:[context,search,list,taskFooter].every(node=>node.parentElement===chooser),stacked:contextBox.bottom<=searchBox.top+1&&searchBox.bottom<=listBox.top+1&&listBox.bottom<=footerBox.top+1,fullWidth:Math.abs(listBox.width-chooserBox.width)<2,readable:[...list.querySelectorAll('strong')].every(node=>node.getBoundingClientRect().width>=100&&node.getBoundingClientRect().height<=25),footerVisible:footerBox.top>=0&&footerBox.bottom<=w.innerHeight,oneScroll:d.getElementById('dlgBody').scrollHeight<=d.getElementById('dlgBody').clientHeight+1&&listBox.height>=62};
          return {diagnostic:{cli:{x:c.x,y:c.y,width:c.width,height:c.height},hit:target?.tagName+'#'+target?.id+'.'+target?.className},header,footerOverlap,footerReachable,dialogReachable,saveVisible:save.top>=0&&save.bottom<=w.innerHeight,
            sendVisible:send.left>=panel.left&&send.right<=panel.right+1&&send.bottom<=w.innerHeight,sendAligned,
            task,overflow:d.documentElement.scrollWidth>w.innerWidth};
        })()`);
        assert.equal(layout.header.overlap, false, `${width}: header controls overlap`);
        assert.equal(layout.header.export, false, `${width}: export belongs in More`);
        if (width <= 1200) assert.equal(layout.header.usage, false, `${width}: usage crowds the header`);
        assert(layout.header.more && layout.header.theme, `${width}: header actions accessible`);
        assert.equal(layout.footerOverlap, false, `${width}x${height}: projects overlap footer`);
        for (const key of ['footerReachable','dialogReachable','saveVisible','sendVisible','sendAligned']) assert(layout[key], `${width}x${height}: ${key} ${JSON.stringify(layout.diagnostic)}`);
        assert.equal(layout.overflow, false, `${width}: horizontal page overflow`);
        for(const [key,value] of Object.entries(layout.task))assert.equal(value,true,`${width}x${height}: task ${key} ${JSON.stringify(layout.task)}`);
        await evaluate(`document.getElementById('layoutFixture').contentWindow.closeDlg()`);
      }
      console.log('  ✓ 6 responsive sizes: reachable controls and a stacked task chooser with readable cards and one scrolling list');
    } finally { await evaluate(`document.getElementById('layoutFixture')?.remove()`); }
    console.log('[workspace-ui] passed');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    try { await browser('close'); } catch {}
    if (server) { server.kill(); await sleep(500); }
    const target = path.resolve(DATA); assert.equal(path.dirname(target), path.resolve(os.tmpdir())); assert(path.basename(target).startsWith('ah-workspace-ui-'));
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})();
