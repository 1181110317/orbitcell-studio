'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
module.exports=function checkMarkdown(){
  const root=path.resolve(__dirname,'../..'),app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const context=vm.createContext({window:{markdownit:require(path.join(root,'public/vendor/markdown-it.min.js')),markdownitFootnote:require(path.join(root,'public/vendor/markdown-it-footnote.min.js')),hljs:{getLanguage:n=>['javascript','js','python','bash','mermaid'].includes(n)}},esc:escape,artifactImageHtml:(src,alt)=>'<button data-imgfile="'+escape(src)+'"><img alt="'+escape(alt)+'"></button>'});
  context.conversationPref=name=>require('../../public/conversation-preferences.js').defaults[name];
  vm.runInContext(app.slice(app.indexOf('function mermaidBlockHtml('),app.indexOf('function md(')),context);
  vm.runInContext(fs.readFileSync(path.join(root,'public/markdown.js'),'utf8'),context);
  const render=src=>context.window.AgentHubMarkdown.render(src),count=(html,s)=>(html.match(s)||[]).length;
  const formula=String.raw`H(p,q)=-\sum_{i}p(i)\log q(i)`;
  for(const source of [String.raw`\(p\)`,String.raw`$x$`,String.raw`$$x^2$$`,String.raw`\[x^2\]`])assert(render(source).includes('data-katex="1"'),source+' is recognized');
  const block=render('说明\n\\[\n'+formula+'\n\\]\n\n后文');assert(block.includes(formula)&&block.includes('后文'),'bracket formulas preserve original TeX and following prose');
  assert(!render('费用 $20 和 $30，另有 \\$5。').includes('data-katex'),'currency is not interpreted as TeX');
  assert(!render('`$x$ \\(p\\)`').includes('data-katex'),'inline code stays literal');
  const code=render('~~~~javascript\nconst value = "$x$";\n```\n~~~~');assert(code.includes('data-codecopy')&&code.includes('```')&&!code.includes('data-katex'),'tilde fences preserve nested backticks and literal math');
  const unclosed=render('\\[\nx + y\n\n## 后文\n\n| A | B |\n|---|---|\n| 1 | 2 |');assert(unclosed.includes('<h2>后文</h2>')&&unclosed.includes('md-table'),'unclosed math never consumes later headings or tables');
  const protectedTex=render(String.raw`$x_{a*b} + \text{a_b}$`);assert(protectedTex.includes('x_{a*b}')&&!protectedTex.includes('<em>'),'math is protected from emphasis transformations');
  const nested=render('3. 一级\n   - 二级\n     - 三级\n4. 下一项');assert(nested.includes('<ol start="3">')&&count(nested,/<ul>/g)===2,'nested lists and ordered start numbers are retained');
  const tasks=render('- [x] 完成\n- [ ] 待办');assert(tasks.includes('aria-checked="true"')&&tasks.includes('aria-checked="false"'),'task states have consistent accessible icons');
  const table=render('| A | B |\n|---|---|\n| a\\|b | `x\\|y` |');assert(count(table,/<td>/g)===2&&table.includes('<code>x|y</code>'),'escaped pipes, including code, do not split table cells');
  assert(render('| A | B |\n| 1 | 2 |').includes('md-table'),'existing no-separator model tables remain readable');
  const foot1=render('引用[^1]\n\n[^1]: 说明'),foot2=render('引用[^1]\n\n[^1]: 说明');assert(foot1.includes('footnote-ref')&&foot1.match(/id="([^"]+)"/)[1]!==foot2.match(/id="([^"]+)"/)[1],'footnotes render and use unique anchors per message');
  const streamFootnote='引用[^1]\n\n[^1]: 说明',streamContext={docId:'ah-live-test'};
  assert.equal(context.window.AgentHubMarkdown.render(streamFootnote,streamContext),context.window.AgentHubMarkdown.render(streamFootnote,streamContext),'one streaming block keeps stable footnote IDs between paints');
  assert(!context.window.AgentHubMarkdown.render(streamFootnote,{docId:'bad" onclick="unsafe'}).includes('onclick='),'custom document IDs cannot inject attributes into footnote anchors');
  const streamDocuments=[
    '# 标题\n\n第一段有 **强调** 与 `src/app.js`。\n\n- 第一项\n- 第二项\n  - 嵌套项\n\n最后一段。',
    '代码示例\n\n```js\nconst value = 1;\n\nconst next = 2;\n```\n\n## 结果\n\n代码后面的正文。',
    '标题\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n后文。\n\n| A | B |\n| 3 | 4 |',
    '![预览](./result.png)\n\n```mermaid\ngraph LR; A-->B\n```\n\n图表后文。',
    '引用 [文档][ref]。\n\n[ref]: https://example.com\n\n引用[^1]。\n\n[^1]: 脚注。',
    '\\[\nx + y\n\n## 公式中间的文本\n\\]\n\n最后一段。',
  ];
  for(const document of streamDocuments){
    const state={docId:'ah-stream-compat'};let prefix='';
    for(let end=1;end<=document.length;end++){
      const source=document.slice(0,end),result=context.window.AgentHubMarkdown.stream(source,state);
      let html;
      if(typeof result==='string'){prefix='';html=result;}
      else {if(result.reset)prefix='';prefix+=result.prefix;html=prefix+result.tail;}
      assert.equal(html,context.window.AgentHubMarkdown.render(source,{docId:state.docId}),'streaming Markdown must match a full render at every character boundary');
    }
  }
  assert(render('[文档][ref]\n\n[ref]: https://example.com/a').includes('href="https://example.com/a"'),'reference links are supported');
  assert(render('https://example.com').includes('<a'),'bare explicit HTTP links remain clickable');
  assert(render('`tests/smoke_endpoints.py`').includes('data-md-file="tests/smoke_endpoints.py"'),'inline code filenames open the file workspace');
  assert(render('`/tmp/mon-refresh/`').includes('data-md-directory="1"'),'directory references are actionable without a file extension');
  assert(render('`captures/`').includes('data-md-directory="1"'),'relative directory references are clickable');
  assert(render('`captures/sub`').includes('data-md-file="captures/sub"'),'inline code paths without an extension or trailing slash can be resolved on the target');
  assert(!render('`tok/s` 和 `MB/s`').includes('data-md-file'),'rate units are not interpreted as paths');
  assert(render('`My Folder/demo.md`').includes('data-md-file="My Folder/demo.md"'),'quoted relative paths retain spaces');
  assert(render('`127.0.0.1:9000`').includes('href="http://127.0.0.1:9000"'),'local server addresses without a scheme are HTTP links');
  assert(render('[服务](localhost:9000)').includes('href="http://localhost:9000"'),'explicit local-address links also receive the HTTP scheme');
  assert(render('查看 src/main.py 和 /tmp/figure.png。').includes('data-md-file="src/main.py"'),'ordinary prose paths are clickable without backticks');
  assert(render('普通路径：src/main.py；').includes('data-md-file="src/main.py"'),'Chinese punctuation does not become part of the path');
  assert(render('`C:\\My Project\\main.py:42:3`').includes('data-md-line="42"'),'Windows paths with spaces retain their location suffix as metadata');
  assert(render('[文件](file:///C:/My%20Project/main.py)').includes('data-md-file="C:/My Project/main.py"'),'file URIs become safe workspace actions');
  const nestedLink=render('[`src/main.py`](https://example.com)');assert.equal(count(nestedLink,/<a /g),1,'code inside an existing Markdown link never creates a nested link');
  assert(!render('`NaN|undefined|Infinity` 与 `x / y`').includes('data-md-file'),'code expressions and diagnostics remain literal');
  assert(!render('```text\nsrc/main.py\n```').includes('data-md-file'),'fenced code is not changed by path recognition');
  assert(render('![远程](https://example.com/chart.png)').includes('data-md-image'),'remote Markdown images expose the existing image viewer');
  assert(render('![示例](./figure.png)').includes('data-imgfile="./figure.png"'),'local image widgets keep their preview route');
  const relative=context.window.AgentHubMarkdown.render('![图](<../images/图 a.png>)\n\n[源码](./a.js)',{filePath:'/project/docs/README.md'});assert(relative.includes('data-imgfile="/project/images/图 a.png"')&&relative.includes('data-md-file="/project/docs/a.js"'),'Markdown files resolve encoded images and links against their own directory');
  const hostile=render('<script>alert(1)</script>\n\n[x](javascript:alert(1))');assert(!hostile.includes('<script>')&&!hostile.includes('href="javascript:'),'raw HTML and unsafe links do not execute');
  for(const invalid of ['javascript:alert(1)','data:text/html,test','localhost:99999','a\u0000.py'])assert.equal(context.window.AgentHubMarkdown.referenceTarget(invalid),null,'invalid references stay non-actionable');
  assert(render('```bash\necho fixture\n```').includes('data-runblock="bash"'),'runnable code keeps its explicit action');
  assert(render('```mermaid\ngraph LR; A-->B\n```').includes('mm-toolbar'),'Mermaid retains diagram/source controls');
  assert(render('```wavedrom\n{}\n```').includes('waveform-box'),'WaveDrom retains its renderer');
  const katex=require(path.join(root,'public/vendor/katex/katex.min.js'));assert(katex.renderToString(formula,{trust:false,maxExpand:1000,maxSize:20}).includes('katex-mathml'),'the screenshot cross-entropy equation renders with the actual bundled math engine');
  const long='\\[\n'.repeat(2000)+'# 结束';const before=performance.now();assert(render(long).includes('结束'));assert(performance.now()-before<2000,'many unclosed formula openers remain bounded');
  console.log('[markdown] 4 TeX delimiters, exact formulas, code/currency isolation, nested lists, tasks, table escapes, footnotes, links/images, diagrams, HTML safety and malformed-input performance passed');
};
