'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const text=fs.readFileSync(path.resolve(__dirname,'../../public/app.js'),'utf8');
const source=(a,b)=>text.slice(text.indexOf(a),text.indexOf(b,text.indexOf(a)));
module.exports=(async()=>{
  const moveIndex=vm.runInNewContext(source('function queueMoveIndex(', '\nasync function queueTrayAction(')+';queueMoveIndex');
  const positions=['a','b','c','d'].map(qid=>({qid}));
  // Every insertion boundary is tested in both directions (including self-drops).
  for (let from=0;from<4;from++) for (let to=0;to<4;to++) for (const after of [false,true]) {
    const expected=positions.map(item=>item.qid), item=expected.splice(from,1)[0];
    const at=from===to?from:expected.indexOf(positions[to].qid)+(after?1:0);
    expected.splice(at,0,item);
    const index=moveIndex(positions,positions[from].qid,positions[to].qid,after);
    const actual=positions.map(item=>item.qid), removed=actual.splice(from,1)[0];actual.splice(index,0,removed);
    assert.deepEqual(actual,expected,'drop insertion keeps the requested relative position');
  }
  assert.equal(moveIndex(positions,'missing','a',false),-1);
  assert.equal(moveIndex(positions,'a','missing',false),-1);
  const input={value:'',focus(){this.focused=true},setSelectionRange(){}},image={path:'/test/zoom.jpg',url:'/uploads/zoom.jpg'};
  const S={curSessionId:'a',readOnly:false,attachments:[],queue:{a:[{qid:'queued',text:'编辑消息',images:[image]}]}};
  let failed=false,navigating=false,removed=0,rendered=0,save,stash,notice;
  const context={S,$:()=>input,isSafeImageUrl:url=>url.startsWith('/uploads/'),composerDraftActiveKey:'a',composerDraftKey:()=>S.curSessionId,
    saveComposerDraft:(...args)=>{save=args},composerDrafts:()=>({}),preserveDraft:(...args)=>{stash=args},
    toast:message=>{notice=message},renderAttachments:()=>{rendered++},autoGrow(){},
    serverQueueAction:async(id,action,index)=>{if(failed)return false;S.queue[id].splice(index,1);removed++;if(navigating)S.curSessionId='b';return true},
  };
  const restore=vm.runInNewContext(source('async function restoreQueueToComposer(', '\nfunction renderQueueTray(')+';restoreQueueToComposer',context);
  input.value='当前草稿';await restore('a','queued');
  assert.equal(removed,0);assert.equal(input.value,'当前草稿');assert(notice.includes('当前草稿'));
  input.value='';failed=true;await restore('a','queued');
  assert.equal(input.value,'');assert.equal(S.queue.a.length,1,'a failed queue removal leaves the item intact');
  failed=false;await restore('a','queued');
  assert.equal(input.value,'编辑消息');assert.equal(S.attachments[0],image);assert(input.focused);assert.equal(rendered,1);assert.equal(S.queue.a.length,0);
  input.value='';S.attachments=[];S.queue.a=[{qid:'next',text:'跨会话恢复',images:[image]}];navigating=true;
  await restore('a','next');assert.equal(input.value,'','a late response cannot fill the other session composer');
  assert.equal(save[0],'a');assert.equal(save[1],'跨会话恢复');assert.equal(save[2][0],image);assert.equal(stash,undefined);
  S.readOnly=true;S.curSessionId='a';S.queue.a=[{qid:'readonly',text:'只读'}];await restore('a','readonly');assert.equal(S.queue.a.length,1);

  const box={scrollTop:150,scrollHeight:500,clientHeight:250};
  const followFrames=[];
  let autoFollow=true;
  const follow=vm.runInNewContext(source('const messageFollow =', '\nfunction renderMessages(')+';({messageFollow,shouldFollowMessages,followMessagesToEnd,messageScrollInput,noteMessageScroll})',{S: {curSessionId:'a'},conversationPref:()=>autoFollow,$:()=>box,requestAnimationFrame:fn=>{followFrames.push(fn);return followFrames.length;}});
  follow.messageFollow.sessionId='a';follow.messageFollow.enabled=false;follow.followMessagesToEnd();
  assert.equal(box.scrollTop,150,'within 100 pixels of the bottom, reading intent still prevents forced following');
  follow.messageFollow.enabled=true;follow.followMessagesToEnd('b');assert.equal(box.scrollTop,150,'background replies cannot scroll the current session');
  for(let i=0;i<20;i++)follow.followMessagesToEnd('a');assert.equal(followFrames.length,1,'a burst of output schedules one scroll write per frame');followFrames.shift()();assert.equal(box.scrollTop,500,'an explicit follow action resumes output following');
  box.scrollTop=150;follow.followMessagesToEnd('a');follow.messageFollow.enabled=false;followFrames.shift()();assert.equal(box.scrollTop,150,'upward scrolling before a queued frame still cancels following');
  autoFollow=false;follow.messageFollow.enabled=true;follow.followMessagesToEnd('a');assert.equal(followFrames.length,0,'turning off automatic follow schedules no output-driven scrolling');
  autoFollow=true;follow.messageFollow.top=250;box.scrollTop=180;follow.noteMessageScroll(box);assert(follow.messageFollow.enabled,'an upward layout correction without user input cannot cancel following');
  follow.messageScrollInput(-1,box);box.scrollTop=120;follow.noteMessageScroll(box);assert(!follow.messageFollow.enabled,'upward user intent pauses before output can repaint');
  follow.messageScrollInput(1,box);box.scrollTop=210;follow.noteMessageScroll(box);assert(!follow.messageFollow.enabled,'scrolling toward the bottom does not resume early');
  box.scrollTop=250;follow.noteMessageScroll(box);assert(follow.messageFollow.enabled,'only reaching the real bottom resumes following');
  follow.messageScrollInput(-1,box);box.scrollTop=100;follow.noteMessageScroll(box);box.scrollHeight=350;follow.noteMessageScroll(box);assert(!follow.messageFollow.enabled,'a collapse reaching the bottom cannot reverse upward reading intent');
  box.scrollHeight=500;box.scrollTop=250;follow.messageFollow.enabled=true;follow.messageFollow.top=250;follow.messageFollow.pointer=7;box.scrollTop=150;follow.noteMessageScroll(box);assert(!follow.messageFollow.enabled,'dragging the main scrollbar upward pauses following');follow.messageFollow.pointer=null;
  const innerFrames=[],inner={scrollTop:800,scrollHeight:1000,clientHeight:200,isConnected:true};
  const output=vm.runInNewContext(source('const outputScrollStates =','\nfunction thinkingSliceEnd(')+';({setOutputFollow,noteOutputScroll,outputScrollAnchor,followOutputArea})',{conversationPref:()=>true,requestAnimationFrame:fn=>{innerFrames.push(fn);return innerFrames.length;}});
  output.setOutputFollow(inner,true);inner.scrollHeight=1400;output.noteOutputScroll(inner);
  assert.equal(output.outputScrollAnchor(inner).follow,true,'new chunk layout must not cancel bottom-follow intent');
  output.followOutputArea(inner,output.outputScrollAnchor(inner));assert.equal(inner.scrollTop,1400);
  inner.scrollTop=1200;output.setOutputFollow(inner,false);output.noteOutputScroll(inner);assert.equal(output.outputScrollAnchor(inner).follow,false,'a pending scroll at the old bottom must not undo an upward key/wheel pause');
  output.setOutputFollow(inner,false);inner.scrollTop=500;innerFrames.shift()();assert.equal(inner.scrollTop,500,'manual pause wins over an already scheduled output frame');
  inner.scrollHeight=1800;output.noteOutputScroll(inner);assert.equal(output.outputScrollAnchor(inner).follow,false,'upward reading remains paused while content grows');
  inner.scrollTop=1600;output.noteOutputScroll(inner);assert.equal(output.outputScrollAnchor(inner).follow,true,'reaching the actual bottom resumes following');
  const pane={scrollTop:731,scrollLeft:9,isConnected:true,closest:()=>null};
  const viewScroll=vm.runInNewContext(source('function messageScrollState(','\nlet messageFollowFrame')+';({messageScrollState,restoreMessageScrollState})',{}),savedScroll=viewScroll.messageScrollState({querySelectorAll:()=>[pane]});pane.scrollTop=0;pane.scrollLeft=0;viewScroll.restoreMessageScrollState(savedScroll);assert.equal(pane.scrollTop,731);assert.equal(pane.scrollLeft,9,'cached conversation views restore nested output reading positions');
  const reviewState={curSessionId:'a',review:{token:0,tabs:[],tabSeq:0}},pending=[],opened=[],errors=[];
  const snapshots=vm.runInNewContext(
    source('function reviewRecordVersions(', '\nfunction renderReviewHead(')+
    source('function openTurnSnapshot(', '\nfunction openReviewPreview(')+
    ';({ensureReviewTab,openTurnSnapshot,previewTurnDiff})',{
      S:reviewState,$:()=>({}),resetReviewTabsForSession(){},persistReviewTab(){},
      reviewTabKey:(mode,file)=>mode+':'+file,
      reviewGroups:files=>files.map(f=>({key:f.path,path:f.path,items:[{f,index:0}]})),
      activateReviewTab:id=>{opened.push(id);reviewState.review.token++;},
      api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),
      toast:message=>errors.push(message),
    });
  const toolTab=snapshots.ensureReviewTab('diff','same.ts',[]);
  snapshots.openTurnSnapshot('same.ts',{patch:'fixed patch'},'a',10);
  const fixedTab=reviewState.review.tabs.at(-1);
  assert.notEqual(fixedTab.id,toolTab.id,'a fixed turn snapshot has its own tab, separate from a current tool diff');
  assert.equal(fixedTab.snapshots.get('same.ts').diff,'fixed patch','the saved patch is mounted directly without reading the current file');
  assert.equal(toolTab.snapshots.size,0,'opening a snapshot cannot replace the tool tab cache');
  snapshots.openTurnSnapshot('same.ts',{patch:'fixed patch'},'a',10);
  assert.equal(reviewState.review.tabs.length,2,'opening the same fixed snapshot reuses its tab');
  snapshots.openTurnSnapshot('same.ts',{patch:'other turn'},'a',11);
  assert.equal(reviewState.review.tabs.length,3,'the same file in different turns keeps separate snapshots');
  const diffButton=file=>({disabled:false,dataset:{turnDiff:file,turnTs:'10'},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];}});
  opened.length=0;
  const first=diffButton('first.ts'),second=diffButton('second.ts');
  const firstRequest=snapshots.previewTurnDiff(first),secondRequest=snapshots.previewTurnDiff(second);
  await snapshots.previewTurnDiff(second);
  assert.equal(pending.length,2,'an in-flight snapshot row cannot issue duplicate requests');
  assert.equal(second['aria-busy'],'true');
  pending[1].resolve({ok:true,patch:'second'});await secondRequest;
  pending[0].resolve({ok:true,patch:'first'});await firstRequest;
  assert.equal(opened.length,1,'a slower earlier snapshot cannot replace the latest selection');
  assert(!first.disabled&&!second.disabled&&!second['aria-busy'],'both snapshot controls recover after loading');
  const failure=diffButton('missing.ts'),failureRequest=snapshots.previewTurnDiff(failure);
  pending[2].reject(Error('missing snapshot'));await failureRequest;
  assert(errors.at(-1).includes('missing.ts')&&!failure.disabled,'snapshot failures retain the requested path and allow retry');
  const late=diffButton('late.ts'),lateRequest=snapshots.previewTurnDiff(late);reviewState.curSessionId='b';
  pending[3].resolve({ok:true,patch:'late'});await lateRequest;
  assert.equal(opened.length,1,'a response cannot open a snapshot from the previous session');
  reviewState.curSessionId='a';
  const preview=diffButton('preview.ts'),previewRequest=snapshots.previewTurnDiff(preview);reviewState.review.token++;
  pending[4].resolve({ok:true,patch:'preview'});await previewRequest;
  assert.equal(opened.length,1,'an intervening preview selection is not replaced by a late snapshot');
  console.log('[conversation-recovery] queue draft/attachment recovery, failure and navigation guards, read-only behavior and scroll intent passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
