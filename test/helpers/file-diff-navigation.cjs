'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../public/app.js'),'utf8');
const part=(start,end)=>{const at=source.indexOf(start);assert(at>=0,start);const stop=source.indexOf(end,at);assert(stop>at,end);return source.slice(at,stop);};
let diskReads=0;
const ui=vm.runInNewContext(part('const fileOperationStatsCache =','\nfunction filesRowHtml(')+part('function diffLines(','\nfunction compactDiff(')+part('function unifiedDiffLines(','\n// 行级差异引用')+part('function reviewStats(','\nfunction reviewOpLabel(')+part('async function buildGroupedFileSnapshot(','\nasync function showGroupedDiff(')+';({fileDiffLines,fileOperationStats,fileGroupStats,fileCollectionStats,reviewStats,buildGroupedFileSnapshot})',{
  isBinaryFile:p=>/\.(png|pdf)$/.test(p),hasBinaryText:f=>String(f.newStr||'').includes('\0'),
  api:async()=>{diskReads++;throw Error('history must not read the live disk');},rawFileUrl:p=>p,
});
const count=lines=>[lines.filter(l=>l.t==='add').length,lines.filter(l=>l.t==='del').length];
const operationView=vm.runInNewContext(part('const reviewOperationViews=','\nfunction renderReviewDiff(')+';reviewOperationLines',{reviewRecordVersions:groups=>groups.flatMap(g=>g.items.flatMap(({f})=>[f,f.undone,f.newStr])),fileMetricRecord:f=>f,fileOperationStats:ui.fileOperationStats,fileDiffLines:ui.fileDiffLines,unifiedDiffLines:()=>[]});
const createdGroup={items:[{f:{path:'x.txt',tool:'Write',created:true,oldStr:'',newStr:'a\nb\nc'}},{f:{path:'x.txt',tool:'Edit',oldStr:'b\n',newStr:'B\nC\n'}}]},operation=operationView(createdGroup);
assert.equal(operation.written,3,'creation line counts include the final line without a newline');assert.deepEqual(count(operation.lines),[2,1],'operation mode keeps a concise write record and the actual edit fragment');assert.equal(operation.additions,2);assert.equal(operation.deletions,1);assert.equal(operationView(createdGroup),operation,'repeated operation views reuse the cached comparison');
const baseline=Array.from({length:1100},(_,i)=>'line '+i+'\n');
const changed=baseline.slice();changed[8]='changed early\n';changed[1090]='changed late\n';changed.splice(800,0,'inserted\n');
const large=ui.fileDiffLines(baseline.join(''),changed.join(''));
assert(!large.inexact);assert.deepEqual(count(large),[3,2],'large sparse changes never become a whole-file replacement');
assert.deepEqual(count(ui.fileDiffLines('a\r\n','a\n')),[0,0]);
assert.deepEqual(count(ui.fileDiffLines('a','a\n')),[1,1],'a terminal newline is one changed line, with no artificial empty extra row');
const unrelated=ui.fileDiffLines('x\n'.repeat(1000),'y\n'.repeat(1000));
assert(unrelated.inexact);assert.deepEqual(count(unrelated),[0,0],'exceeding the precision budget does not invent a delete-all/add-all result');
assert(ui.fileDiffLines('','x\n'.repeat(50000)).inexact,'line-count bounds apply before constructing a large row array');
assert(ui.fileDiffLines('x'.repeat(4000001),'').inexact,'character bounds apply before splitting text');
// Compare the large-file path with a simple independent LCS oracle, including
// repeated lines, edits at both ends, insertions and deletions.
function expected(a,b){let prev=new Uint16Array(b.length+1);for(const x of a){const next=new Uint16Array(b.length+1);for(let j=1;j<=b.length;j++)next[j]=x===b[j-1]?prev[j-1]+1:Math.max(prev[j],next[j-1]);prev=next;}return [b.length-prev[b.length],a.length-prev[b.length]];}
for(let seed=1;seed<=12;seed++){
  let random=seed;const next=()=>{random=(random*1664525+1013904223)>>>0;return random;};
  const a=Array.from({length:700},(_,i)=>'repeated '+(i%23)),b=a.slice();b[0]='new start';b[b.length-1]='new end';
  for(let i=0;i<6;i++){const at=1+next()%(b.length-2);if(i%3===0)b.splice(at,0,'insert '+i);else if(i%3===1)b.splice(at,1);else b[at]='replace '+i;}
  const lines=ui.fileDiffLines(a.join('\n')+'\n',b.join('\n')+'\n');assert(!lines.inexact);assert.deepEqual(count(lines),expected(a,b));
}
const patch='diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n---old content\n+++new content\n';
assert.deepEqual([ui.reviewStats({diff:patch}).adds,ui.reviewStats({diff:patch}).dels],[1,1],'content beginning with +++ or --- inside a hunk is content');
const huge=ui.reviewStats({oldStr:'',newStr:'new\n'.repeat(10020)});assert(huge.truncated);assert.equal(huge.lines.length,10000,'full snapshots have the same rendering cap as Git patches');

let escapeHandler;
const layers={menu:false,dialog:false,managed:false,review:true},actions=[];
vm.runInNewContext(part('  // Ctrl+K 搜索 / Esc 关弹窗','\n  initVoiceInput();').replace('  // Ctrl+K 搜索 / Esc 关弹窗',''),{
  document:{addEventListener:(_name,fn)=>{escapeHandler=fn;}},chordOf:()=>'',keybindingFor:(_name,value)=>value,
  get flyMenuEl(){return {classList:{contains:()=>!layers.menu}};},closeFlyMenu:()=>{actions.push('menu');layers.menu=false;},
  $:selector=>({classList:{contains:()=>selector==='#overlay'?!layers.dialog:true}}),
  closeDlg:()=>actions.push('dialog'),window:{AgentHubManagement:{back:()=>{if(!layers.managed)return false;actions.push('management');layers.managed=false;return true;}}},
  S:{review:{open:true}},closeReviewPanel:()=>actions.push('review'),closeCtxPanel(){},toggleSidebar(){},
});
layers.managed=true;escapeHandler({key:'Escape'});assert.deepEqual(actions,['management'],'Escape exits the visible management page before the hidden file workspace');
actions.length=0;layers.dialog=true;layers.menu=true;escapeHandler({key:'Escape'});assert.deepEqual(actions,['menu'],'Escape closes a settings dropdown before the dialog');
actions.length=0;escapeHandler({key:'Escape'});assert.deepEqual(actions,['dialog'],'an already hidden menu must not swallow future Escape keys');
actions.length=0;escapeHandler({key:'Escape',defaultPrevented:true});assert.equal(actions.length,0,'a handled child Escape never also closes its parent');

const tabState={review:{tabs:[],activeTabId:'',tabSeq:0}},groupFor=f=>[{key:'same',path:'same.txt',items:[{f}]}];
const tabs=vm.runInNewContext(part('function reviewRecordVersions(','\nfunction renderReviewHead(')+';({ensureReviewTab})',{S:tabState,resetReviewTabsForSession(){},reviewTabKey:(mode,p)=>mode+':'+p,persistReviewTab(){const active=tabState.review.tabs.find(t=>t.id===tabState.review.activeTabId);if(active){active.groups=tabState.review.groups;active.snapshots=tabState.review.snapshots;active.expanded=tabState.review.expanded;}}});
const firstRecord={path:'same.txt',tool:'Edit',oldStr:'a',newStr:'b'},firstTab=tabs.ensureReviewTab('diff','same.txt',groupFor(firstRecord));
firstTab.snapshots.set('same',{old:true});tabState.review.activeTabId=firstTab.id;tabState.review.groups=firstTab.groups;tabState.review.snapshots=firstTab.snapshots;tabState.review.expanded=firstTab.expanded;
const preserved=firstTab.snapshots;tabs.ensureReviewTab('diff','same.txt',groupFor({...firstRecord}));assert.equal(firstTab.snapshots,preserved,'equivalent refreshed records retain the cached snapshot');
const nextRecord={...firstRecord,newStr:'different turn'};tabs.ensureReviewTab('diff','same.txt',groupFor(nextRecord));assert.equal(firstTab.snapshots.size,0);assert.equal(tabState.review.snapshots,firstTab.snapshots,'active state cannot persist an old snapshot over the replacement');
firstTab.snapshots.set('same',{old:true});nextRecord.undone=true;tabs.ensureReviewTab('diff','same.txt',groupFor(nextRecord));assert.equal(firstTab.snapshots.size,0,'in-place undo changes also invalidate the snapshot');

const managementSource=fs.readFileSync(path.resolve(__dirname,'../../public/management.js'),'utf8'),resumeStart=managementSource.indexOf('  function resumeSession('),resumeEnd=managementSource.indexOf('\n  function suspendSession(',resumeStart);
let displayRenders=0;const draft={value:'unsent draft'};
const resume=vm.runInNewContext('let pendingMessageRender=true,pendingSessionRefresh=false;'+managementSource.slice(resumeStart,resumeEnd)+';resumeSession',{
  document:{body:{classList:{contains:()=>false}},getElementById:id=>id==='inpText'?draft:{classList:{contains:()=>true}}},
  renderMessages:()=>{displayRenders++;},S:{curSessionId:'draft-session',review:{open:false}},openSession:()=>{throw Error('display preferences must not reload or overwrite the draft');},
});
resume();resume();assert.equal(displayRenders,1,'deferred display changes flush once even with an unsent draft');assert.equal(draft.value,'unsent draft');

(async()=>{
  const files=[{path:'x.html',tool:'Write',snapshotUnavailable:true,writtenLines:724},{path:'x.html',tool:'Edit',oldStr:'a\n',newStr:'A\nB\n'},{path:'x.html',tool:'Edit',oldStr:'B\n',newStr:'C\n'}];
  const summary=ui.fileGroupStats(files.map(f=>({f}))),snapshot=await ui.buildGroupedFileSnapshot(files,'x.html'),detail=ui.reviewStats(snapshot);
  assert.deepEqual([summary.additions,summary.deletions],[3,2]);assert.deepEqual([detail.adds,detail.dels],[3,2]);assert.equal(detail.scope,'operations');assert(detail.partial);
  assert(!snapshot.oldStr&&!snapshot.newStr);assert(snapshot._diffScope.includes('部分记录'));assert(snapshot._diffScope.includes('724'));
  assert.equal(diskReads,0,'partial history is never reconstructed from a different current disk file');
  assert.equal(ui.reviewStats(snapshot),detail,'repeated summary/list/body rendering reuses its comparison');
  files[2].undone=true;const afterUndo=await ui.buildGroupedFileSnapshot(files,'x.html'),undoCard=ui.fileGroupStats(files.map(f=>({f})));
  assert.deepEqual([ui.reviewStats(afterUndo).adds,ui.reviewStats(afterUndo).dels],[2,1]);assert.deepEqual([undoCard.additions,undoCard.deletions],[2,1],'undone operations stay in history but no longer contribute to applied totals');
  const complete=[{path:'x.html',tool:'Write',created:false,oldStr:baseline.join(''),newStr:changed.join('')}];
  const whole=await ui.buildGroupedFileSnapshot(complete,'x.html'),wholeStats=ui.reviewStats(whole),card=ui.fileGroupStats(complete.map(f=>({f})));
  assert.equal(wholeStats.scope,'net');assert.deepEqual([wholeStats.adds,wholeStats.dels],[card.additions,card.deletions]);assert.deepEqual([wholeStats.adds,wholeStats.dels],[3,2]);
  const zero=await ui.buildGroupedFileSnapshot([{path:'x',tool:'Write',created:false,oldStr:'a\n',newStr:'b\n'},{path:'x',tool:'Edit',oldStr:'b\n',newStr:'a\n'}],'x');assert.deepEqual([ui.reviewStats(zero).adds,ui.reviewStats(zero).dels],[0,0]);
  const a=[{f:{path:'a',tool:'Write',created:false,oldStr:'a\n',newStr:'b\n'}},{f:{path:'a',tool:'Edit',oldStr:'b\n',newStr:'a\n'}}],b=[{f:{path:'b',tool:'Edit',oldStr:'c\n',newStr:'d\n'}}];
  const cachedA=ui.fileGroupStats(a),collection=ui.fileCollectionStats([{items:a},{items:b}]);
  assert.equal(collection.scope,'operations');assert.deepEqual([collection.additions,collection.deletions],[3,3],'mixed coverage totals use one cumulative scope, never net plus cumulative');assert.equal(ui.fileGroupStats(a),cachedA,'collection summaries do not evict per-file replay results');
  console.log('[file-diff-navigation] shared exact/partial counts, bounded sparse diff, no live-disk baseline, cache, row cap and layered Escape passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
