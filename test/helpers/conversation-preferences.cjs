'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.resolve(__dirname,'../../public/conversation-preferences.js'),'utf8');
function client(storage) {
  const window = {localStorage:storage}; vm.runInNewContext(source,{window}); return window.AgentHubConversationPreferences;
}
const data = new Map(), storage = {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
let prefs = client(storage);
assert.equal(prefs.openFor(prefs.read(),1,'running'),true);
assert.equal(prefs.openFor(prefs.read(),2,'running'),true);
assert.equal(prefs.openFor(prefs.read(),3,'running'),false);
assert.equal(prefs.openFor(prefs.read(),1,'completed',true),false);
assert.equal(prefs.openFor(prefs.read(),1,'history',true),false);
assert(!('thinking' in prefs.read()),'reasoning uses common call preferences, with no independent setting');
assert.equal(prefs.read().mentionedFilesOpen,true,'latest requested file default is retained');
assert.equal(prefs.save({...prefs.read(),historyDepth:'3',toolFold:false,codeWrap:true}),true);
prefs = client(storage);
assert.equal(prefs.read().historyDepth,'3','a fresh page restores saved history expansion');
assert.equal(prefs.read().toolFold,false);
assert.equal(prefs.read().codeWrap,true);
const keep = prefs.normalize({completedDepth:'keep'});
for (const level of [1,2,3]) {
  const settings = {...keep};
  assert.equal(prefs.openFor(settings,level,'completed',false),false);
  assert.equal(prefs.openFor(settings,level,'completed',true),true);
}
const fixed = prefs.normalize({processFold:false,historyDepth:'0'});
assert(prefs.openFor(fixed,1,'history'),'a non-collapsible process stays open');
assert(!prefs.openFor(fixed,2,'history'),'disabling the parent fold does not force open child folds');
const invalid = prefs.normalize({runningDepth:'99',completedDepth:'bad',groupFold:'false',thinking:'inject',htmlScripts:0,unknown:'value'});
assert.equal(invalid.runningDepth,'2');assert.equal(invalid.completedDepth,'0');assert.equal(invalid.groupFold,true);assert(!('thinking' in invalid));assert.equal(invalid.htmlScripts,true);assert(!('unknown' in invalid));
data.set(prefs.key,'{broken'); prefs=client(storage);assert.equal(prefs.read().runningDepth,'2','corrupt storage cannot break application startup');
data.clear();data.set('ah.expandProcess','1');prefs=client(storage);assert.equal(prefs.read().historyDepth,'0','legacy expansion cannot force open the new default');
data.set(prefs.key,JSON.stringify({thinking:'inline',historyDepth:'3',toolFold:false,codeWrap:true}));prefs=client(storage);assert.equal(prefs.read().historyDepth,'0');assert(prefs.read().toolFold);assert(prefs.read().codeWrap);assert(!('thinking' in JSON.parse(data.get(prefs.key))),'retired independent reasoning preferences migrate once without losing other reading choices');
const blocked=client({getItem(){throw Error('disabled');},setItem(){throw Error('quota');}});
assert.equal(blocked.read().historyDepth,'0');assert.equal(blocked.save({runningDepth:'3'}),false);assert.equal(blocked.read().runningDepth,'3','blocked storage still allows current-page preferences');
const html=prefs.htmlDocument('<script>requestAnimationFrame(tick)</script>');
assert(html.indexOf('Content-Security-Policy')<html.indexOf('<script>'),'policy precedes source content');
for(const directive of ["connect-src 'none'","frame-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'"])assert(html.includes(directive));
assert(!html.includes('allow-same-origin')&&!html.includes('unsafe-eval'));
assert(prefs.htmlDocument('<h1>static</h1>',false).includes("script-src 'none'"));
const oldSaved=prefs.normalize({thinking:'fold',completedDepth:'keep',codeWrap:true});
assert.equal(oldSaved.sidebarToolbar,'full','existing display preferences gain the restored full toolbar');
assert.equal(oldSaved.codeWrap,true,'schema expansion retains older saved choices');
assert.equal(Object.keys(oldSaved).length,46,'all shared display controls have validated defaults');
assert.equal(prefs.normalize({answerColor:'#ABCDEF',processColor:'#778899',detailColor:'#AABBCC'}).answerColor,'#abcdef');
assert.equal(prefs.normalize({detailColor:'#AABBCC'}).detailColor,'#aabbcc');
for(const color of ['red','#fff','url(javascript:alert(1))',null,12]) {
  const normalized=prefs.normalize({answerColor:color,processColor:color,detailColor:color});
  for(const name of ['answerColor','processColor','detailColor'])assert.equal(normalized[name],'auto');
}
prefs.save({...prefs.read(),answerColor:'#223344',processColor:'#778899',detailColor:'#5f6b7c'});
prefs=client(storage);
assert.equal(prefs.read().answerColor,'#223344','custom colors survive a reload');
assert.equal(prefs.read().processColor,'#778899');
assert.equal(prefs.read().detailColor,'#5f6b7c');
assert(oldSaved.toolListScroll,'long invocation lists scroll by default');
assert.equal(prefs.normalize({toolListScroll:false,toolListHeight:'bad'}).toolListHeight,'normal');
const badReading=prefs.normalize({chatFontSize:'99999',chatLineHeight:'expression()',codeFontSize:'0',toolOutputHeight:'-1',sendKey:'other',sidebarToolbar:'unknown'});
for(const name of ['chatFontSize','chatLineHeight','codeFontSize'])assert.equal(badReading[name],'auto');
assert.equal(badReading.toolOutputHeight,'normal');assert.equal(badReading.sidebarToolbar,'full');assert.equal(badReading.sendKey,'enter');
const enter={key:'Enter',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false};
assert(prefs.sendsOnEnter(enter,{sendKey:'enter'}));
assert(!prefs.sendsOnEnter(enter,{sendKey:'mod-enter'}));
assert(prefs.sendsOnEnter({...enter,ctrlKey:true},{sendKey:'mod-enter'}));
assert(prefs.sendsOnEnter({...enter,metaKey:true},{sendKey:'mod-enter'}));
for(const blocked of [{shiftKey:true},{altKey:true},{isComposing:true},{key:'Escape'}])for(const sendKey of ['enter','mod-enter'])assert(!prefs.sendsOnEnter({...enter,ctrlKey:true,...blocked},{sendKey}),'IME confirmation, line breaks and other keys never send');
