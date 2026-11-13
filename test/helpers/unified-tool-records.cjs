'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const text=fs.readFileSync(path.resolve(__dirname,'../../public/app.js'),'utf8');
const start=text.indexOf('const fileOperationStatsCache ='),end=text.indexOf('\nfunction filesRowHtml(',start);
const ui=vm.runInNewContext(text.slice(start,end)+';({withWriteEvidence,fileGroupStats,fileOperationStats,replayFileGroupSnapshot})',{isBinaryFile:()=>false,hasBinaryText:()=>false});
const file={path:'C:\\Project\\report.html',tool:'Write',created:false,snapshotUnavailable:true,writtenLines:2};
const tool={type:'tool',name:'Write',status:'done',detail:JSON.stringify({file_path:file.path,content:'a\nb\n'}),output:'File created successfully at: '+file.path+' (file state is current in your context — no need to Read it back)'};
const records=[file,{path:file.path,tool:'Edit',oldStr:'a\n',newStr:'A\nextra\n'},{path:file.path,tool:'Edit',oldStr:'A\n',newStr:'a\n'}];
const resolved=ui.withWriteEvidence(records,[tool]);
assert(resolved[0]._verifiedWrite);assert.equal(resolved[0].created,false);assert.equal(resolved[0].snapshotUnavailable,true);assert.equal(resolved[0].oldStr,undefined,'display proof does not grant a historical undo or rewrite stored fields');assert(!('_verifiedWrite' in file));
const stats=ui.fileGroupStats(resolved.map(f=>({f})));
assert.equal(stats.scope,'net');assert.deepEqual([stats.additions,stats.deletions],[3,0],'first creation plus edits counts final file content once');
assert.equal(ui.replayFileGroupSnapshot(resolved.map(f=>({f}))).newStr,'a\nextra\nb\n');assert.equal(ui.withWriteEvidence(records,[tool]),resolved,'unchanged proof metadata is cached');
for(const bad of [
  {...tool,status:'running'},{...tool,status:'error'},
  {...tool,output:tool.output.replace('report.html','another.html')},
  {...tool,output:'The file has been updated successfully.'},
  {...tool,detail:JSON.stringify({file_path:file.path,content:'wrong line count\n'})},
  {...tool,detail:'{"content":"truncated'},
])assert(!ui.withWriteEvidence(records,[bad])[0]._verifiedWrite,'only a complete successful creation for the same path and line count can prove the baseline');
assert(!ui.withWriteEvidence(records,[tool,{...tool}])[0]._verifiedWrite,'ambiguous duplicate creation results cannot be joined to one file record');
assert(!ui.withWriteEvidence([file,{...file}],[tool])[0]._verifiedWrite,'multiple same-path Writes need an unambiguous operation identity');
const overwrite={...file,snapshotUnavailable:false,oldStr:'existing\n',newStr:'replacement\n'};assert.equal(ui.withWriteEvidence([overwrite],[tool])[0],overwrite,'a known overwrite baseline wins over contradictory display output');
assert(ui.fileOperationStats({path:'empty.txt',tool:'Write',created:false,oldStr:'',newStr:'one\n'}).known,'a captured, explicitly existing empty file has a reliable empty baseline');
const remote={...file,path:'/home/User/report.html'},remoteTool={...tool,detail:JSON.stringify({file_path:remote.path,content:'a\nb\n'}),output:'File created successfully at: '+remote.path};
assert(ui.withWriteEvidence([remote],[remoteTool])[0]._verifiedWrite);assert(!ui.withWriteEvidence([remote],[{...remoteTool,output:remoteTool.output.replace('/User/','/user/')}])[0]._verifiedWrite,'POSIX creation paths retain their case');
const pending={...tool,status:'running'};assert.equal(ui.withWriteEvidence(records,[pending]),records);pending.status='done';assert(ui.withWriteEvidence(records,[pending])[0]._verifiedWrite,'a completed live Write can update a previously unknown file count');
console.log('[unified-tool-records] verified creation baseline, final net counts, path/status/coverage guards, ambiguous records, cache and unchanged undo fields passed');
