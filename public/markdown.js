/* Local CommonMark/GFM parsing with safe application renderers and TeX tokens. */
(() => {
  'use strict';
  if (!window.markdownit) return;
  const engine=window.markdownit({html:false,breaks:true,linkify:true,typographer:false,maxNesting:50});
  engine.linkify.set({fuzzyLink:false,fuzzyEmail:false});
  if(window.markdownitFootnote) engine.use(window.markdownitFootnote);
  const escape=engine.utils.escapeHtml;
  let documentSerial=0;
  function localPath(value,env){
    let file=String(value).split(/[?#]/)[0];try{file=decodeURIComponent(file);}catch{}
    if(!env.filePath || /^(?:\/|[A-Za-z]:[\\/])/.test(file))return file;
    const base=String(env.filePath).replace(/\\/g,'/').replace(/[^/]*$/,''),joined=base+file,prefix=/^(?:[A-Za-z]:\/|\/)/.exec(joined)?.[0]||'',parts=[];
    for(const segment of joined.slice(prefix.length).split('/')){if(!segment||segment==='.')continue;if(segment==='..'&&parts.length&&parts[parts.length-1]!=='..')parts.pop();else if(segment!=='..'||!prefix)parts.push(segment);}
    return prefix+parts.join('/');
  }
  function referenceTarget(value,env={},explicit=false){
    let raw=String(value??'').trim();
    if(!raw||raw.length>4096||/[\u0000-\u001f\u007f<>`|]/.test(raw))return null;
    if(/^https?:\/\/[^\s"<>]+$/i.test(raw))return {kind:'web',href:raw};
    if(/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[::1\]):\d{1,5}(?:[/?#][^\s"<>]*)?$/i.test(raw)){
      const port=Number(/:(\d+)(?:[/?#]|$)/.exec(raw)?.[1]);
      return port>0&&port<=65535?{kind:'web',href:'http://'+raw}:null;
    }
    if(/^file:\/\//i.test(raw))raw=raw.replace(/^file:\/\/\/([A-Za-z]:)/i,'$1').replace(/^file:\/\/\//i,'/').replace(/^file:\/\//i,'//');
    if(raw.startsWith('#')||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)&&! /^[A-Za-z]:[\\/]/.test(raw))return null;
    const location=/(?:#L(\d+)(?:C(\d+))?(?:-L?\d+)?|:(\d+)(?::(\d+))?)$/.exec(raw);
    const parsedLine=location?Number(location[1]||location[3]):0,line=Number.isSafeInteger(parsedLine)&&parsedLine>0?parsedLine:0;
    if(location)raw=raw.slice(0,location.index);
    const named=/^(?:Dockerfile|Containerfile|Makefile|GNUmakefile|Justfile|Taskfile|Procfile|Gemfile|Rakefile|LICENSE|README|NOTICE|CHANGELOG|AUTHORS|COPYING)(?:\.[\w.-]+)?$/i;
    const leaf=raw.split(/[\\/]/).pop(),absolute=/^(?:[A-Za-z]:[\\/]|\/|\\\\|~[\\/])/.test(raw);
    const file=/\.[A-Za-z][A-Za-z0-9]{0,11}$/.test(raw)||named.test(leaf);
    if(!explicit&&!absolute&&!/^\.{1,2}[\\/]/.test(raw)&&!/[\\/]$/.test(raw)&&!file)return null;
    if(!explicit&&/\s/.test(raw)&&!absolute&&(!file||!/[\\/]/.test(raw)||/\s[\\/]\s/.test(raw)||/^(?:python\d*|node|npm|npx|git|curl|cat|type|echo|ls|dir|cd|bash|sh|pwsh|powershell)\s/i.test(raw)))return null;
    if(/[;={}]/.test(raw)||/\s--?\w/.test(raw))return null;
    const path=localPath(raw,env);
    if(!path)return null;
    return {kind:/[\\/]$/.test(raw)?'directory':'file',path,line};
  }
  function referenceHtml(value,label=value,env={},className='',explicit=false){
    const target=referenceTarget(value,env,explicit),text=escape(String(label));
    if(!target)return text;
    const cls=className?' class="'+escape(className)+'"':'';
    if(target.kind==='web')return '<a'+cls+' href="'+escape(target.href)+'" target="_blank" rel="noopener noreferrer">'+text+'</a>';
    return '<a'+cls+' href="#" data-md-file="'+escape(target.path)+'"'+(target.kind==='directory'?' data-md-directory="1"':'')+(target.line?' data-md-line="'+target.line+'"':'')+' title="查看'+(target.kind==='directory'?'目录':'文件')+' '+escape(target.path)+'">'+text+'</a>';
  }
  function referenceTextHtml(value,env={}){
    const text=String(value??'');let html='',last=0;
    for(const match of text.matchAll(/[^\s<>()[\]{}"'`，。；：！？]+/gu)){
      const candidate=match[0].replace(/[.,;:!?]+$/,'');
      if(!referenceTarget(candidate,env))continue;
      html+=escape(text.slice(last,match.index))+referenceHtml(candidate,candidate,env);last=match.index+candidate.length;
    }
    return html+escape(text.slice(last));
  }
  const validateLink=engine.validateLink;
  engine.validateLink=url=>/^file:\/\//i.test(url)?!!referenceTarget(url):validateLink(url);
  function closing(source,delimiter,start,limit){
    let at=start;
    while((at=source.indexOf(delimiter,at))>=0 && at<=limit){
      let slashes=0;for(let i=at-1;i>=0&&source[i]==='\\';i--)slashes++;
      if(slashes%2===0) return at;
      at+=delimiter.length;
    }
    return -1;
  }
  engine.inline.ruler.before('escape','agenthub_math',(state,silent)=>{
    const at=state.pos,source=state.src;
    let open,close,display=false;
    if(source.startsWith('\\(',at)){open='\\(';close='\\)';}
    else if(source.startsWith('\\[',at)){open='\\[';close='\\]';display=true;}
    else if(source.startsWith('$$',at)){open=close='$$';display=true;}
    else if(source[at]==='$' && source[at-1]!=='\\' && source[at-1]!=='$'){open=close='$';}
    else return false;
    const start=at+open.length;
    if(close==='$' && (!source[start]||/\s/.test(source[start])))return false;
    const end=closing(source,close,start,Math.min(state.posMax,start+16384));
    if(end<=start || end+close.length>state.posMax)return false;
    const tex=source.slice(start,end);
    if(close==='$' && (/\s/.test(source[end-1]) || /[\d$]/.test(source[end+1]||'') || tex.includes('\n')))return false;
    if(!silent){const token=state.push(display?'math_display':'math_inline','',0);token.content=tex;}
    state.pos=end+close.length;return true;
  });
  engine.block.ruler.before('fence','agenthub_math_block',(state,startLine,endLine,silent)=>{
    if(state.sCount[startLine]-state.blkIndent>=4)return false;
    const first=state.src.slice(state.bMarks[startLine]+state.tShift[startLine],state.eMarks[startLine]);
    const match=/^(\$\$|\\\[)(.*)$/.exec(first);if(!match)return false;
    const close=match[1]==='$$'?'$$':'\\]',pieces=[];let length=0;
    for(let line=startLine;line<Math.min(endLine,startLine+512);line++){
      const value=line===startLine?match[2]:state.src.slice(state.bMarks[line]+state.tShift[line],state.eMarks[line]);
      if(line>startLine && /^\\\[/.test(value))return false;
      const end=closing(value,close,0,value.length);
      if(end>=0){
        const tail=value.slice(end+close.length);if(tail.trim())return false;
        pieces.push(value.slice(0,end));const tex=pieces.join('\n').trim();if(!tex||tex.length>65536)return false;
        if(silent)return true;
        const token=state.push('math_display','',0);token.block=true;token.content=tex;token.map=[startLine,line+1];state.line=line+1;return true;
      }
      pieces.push(value);length+=value.length;if(length>65536)return false;
    }
    return false;
  },{alt:['paragraph','reference','blockquote','list']});
  engine.renderer.rules.math_inline=(tokens,index)=>'<span class="math-inline" data-katex="1">'+escape(tokens[index].content)+'</span>';
  engine.renderer.rules.math_display=(tokens,index)=>'<span class="math-block" data-katex="1">'+escape(tokens[index].content)+'</span>\n';
  engine.renderer.rules.fence=(tokens,index)=>markdownFenceHtml(tokens[index].content.replace(/\n$/,''),tokens[index].info.trim().split(/\s+/)[0]);
  engine.renderer.rules.code_block=(tokens,index)=>markdownFenceHtml(tokens[index].content.replace(/\n$/,''),'');
  engine.renderer.rules.code_inline=(tokens,index,options,env)=>{
    const text=tokens[index].content,code='<code>'+escape(text)+'</code>';
    if(tokens[index].meta?.insideLink)return code;
    const codePath=/^[^\s<>`|;={}]+[\\/][^\s<>`|;={}]+$/.test(text)&&!/^(?:tok(?:en)?s?|[kmg]?i?b|m|km|requests)\/(?:s|ms|min|h)$/i.test(text);
    const linked=referenceHtml(text,text,env,'code-link',codePath);
    return linked.startsWith('<a ')?linked.replace('>'+escape(text)+'</a>','>'+code+'</a>'):code;
  };
  const linkOpen=engine.renderer.rules.link_open || ((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
  engine.renderer.rules.link_open=(tokens,index,options,env,self)=>{
    const href=tokens[index].attrGet('href')||'';
    const target=referenceTarget(href,env,true);
    if(target?.kind==='web'){tokens[index].attrSet('href',target.href);tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');}
    else {
      if(target&&target.kind!=='web'){
        tokens[index].attrSet('href','#');tokens[index].attrSet('data-md-file',target.path);tokens[index].attrSet('title',target.path);
        if(target.kind==='directory')tokens[index].attrSet('data-md-directory','1');
        if(target.line)tokens[index].attrSet('data-md-line',String(target.line));
      }
    }
    return linkOpen(tokens,index,options,env,self);
  };
  engine.renderer.rules.image=(tokens,index,options,env)=>{
    const token=tokens[index],src=token.attrGet('src')||'',alt=token.content||'';
    if(src && !/^(?:https?:|data:)/i.test(src) && /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)(?:$|[?#])/i.test(src) && referenceTarget(src,env,true))return artifactImageHtml(localPath(src,env),alt||src,'md-inline-image');
    if(/^https?:/i.test(src) || /^data:image\/(?:png|gif|jpeg|webp);base64,/i.test(src)){
      const image='<img class="md-remote-image" src="'+escape(src)+'" alt="'+escape(alt)+'" loading="lazy" decoding="async">';
      return token.meta?.insideLink?image:'<button type="button" class="md-image-link" data-md-image data-img="markdown" aria-label="放大查看 '+escape(alt||'图片')+'">'+image+'</button>';
    }
    return escape(alt||src);
  };
  engine.core.ruler.after('linkify','agenthub_references',state=>{
    for(const inline of state.tokens){
      if(inline.type!=='inline'||!inline.children)continue;
      let depth=0;const children=[];
      for(const token of inline.children){
        if(token.type==='link_open')depth++;
        if(['code_inline','image'].includes(token.type)&&depth)token.meta={...token.meta,insideLink:true};
        if(token.type!=='text'||depth){children.push(token);}
        else {const html=referenceTextHtml(token.content,state.env);if(html===escape(token.content))children.push(token);else{const link=new state.Token('html_inline','',0);link.content=html;children.push(link);}}
        if(token.type==='link_close')depth--;
      }
      inline.children=children;
    }
  });
  engine.core.ruler.after('inline','agenthub_tasks',state=>{
    for(let i=2;i<state.tokens.length;i++){
      const inline=state.tokens[i],item=state.tokens[i-2];
      if(inline.type!=='inline'||state.tokens[i-1].type!=='paragraph_open'||item.type!=='list_item_open'||!inline.children?.length)continue;
      const first=inline.children[0],match=first.type==='text'&&/^\[([ xX])\]\s+/.exec(first.content);if(!match)continue;
      const checked=match[1].toLowerCase()==='x';first.content=first.content.slice(match[0].length);item.attrJoin('class','md-task'+(checked?' is-checked':''));
      const box=new state.Token('html_inline','',0);box.content='<span class="md-task-check" role="checkbox" aria-readonly="true" aria-checked="'+checked+'" aria-label="'+(checked?'已完成':'未完成')+'">'+(checked?'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>':'')+'</span>';
      inline.children.unshift(box);
    }
  });
  const tableOpen=engine.renderer.rules.table_open || ((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
  const tableClose=engine.renderer.rules.table_close || ((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
  engine.renderer.rules.table_open=(tokens,index,options,env,self)=>{tokens[index].attrJoin('class','md-table');return '<div class="md-table-scroll">'+tableOpen(tokens,index,options,env,self);};
  engine.renderer.rules.table_close=(tokens,index,options,env,self)=>tableClose(tokens,index,options,env,self)+'</div>\n';
  function looseTables(source){
    const lines=source.split('\n'),out=[];let fence=null,math=null;
    for(let i=0;i<lines.length;i++){
      const line=lines[i],marker=/^\s*(`{3,}|~{3,})/.exec(line);
      if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;out.push(line);continue;}
      if(!fence && math){out.push(line);if(closing(line,math,0,line.length)>=0)math=null;continue;}
      const mathOpen=!fence&&/^\s*(\$\$|\\\[)/.exec(line);
      if(mathOpen){const end=mathOpen[1]==='$$'?'$$':'\\]';if(closing(line,end,line.indexOf(mathOpen[1])+mathOpen[1].length,line.length)<0)math=end;out.push(line);continue;}
      out.push(line);
      if(!fence&&/^\s*\|.+\|\s*$/.test(line)&&/^\s*\|.+\|\s*$/.test(lines[i+1]||'')&&!/^\s*\|?[\s:|-]+\|\s*$/.test(lines[i+1]||'')&&!/^\s*\|.+\|\s*$/.test(lines[i-1]||'')){
        const columns=(line.trim().slice(1,-1).match(/(?<!\\)\|/g)||[]).length+1;
        if(columns>1&&columns<=128)out.push('|'+Array(columns).fill('---').join('|')+'|');
      }
    }
    return out.join('\n');
  }
  if(engine.renderer.rules.footnote_anchor){
    const anchor=engine.renderer.rules.footnote_anchor;
    engine.renderer.rules.footnote_anchor=(...args)=>anchor(...args).replace('<a ','<a aria-label="返回引用" ').replace(/↩[\uFE0E\uFE0F]?/,window.AgentHubIcons?.svg('quote')||'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6-5 5 5 5M4 11h9a7 7 0 0 1 7 7"/></svg>');
  }
  if(typeof document!=='undefined')document.addEventListener('click',event=>{
    if(event.defaultPrevented)return;
    const link=event.target.closest('.md-body [data-md-file], #messages [data-md-file], .content-directory [data-md-file]'),image=event.target.closest('.doc-preview .artifact-image[data-imgfile]');
    if(link){event.preventDefault();event.stopPropagation();openContentReference(link.dataset.mdFile,{directory:link.dataset.mdDirectory==='1',line:Number(link.dataset.mdLine)||0});}
    else if(image&&!image.closest('#messages')&&!image.disabled){event.preventDefault();openReviewPreview(image.dataset.imgfile);}
    else if(event.target.closest('.doc-preview [data-md-image]')){const img=event.target.closest('[data-md-image]').querySelector('img');if(img)openDlg('图片',imageViewerHtml(img.currentSrc||img.src,img.alt));}
    else {const web=event.target.closest('.md-body a[href]');if(web&&/^https?:/i.test(web.getAttribute('href')||'')&&!event.ctrlKey&&!event.metaKey&&event.button===0){event.preventDefault();openPage(web.href);}}
  });
  function render(source,context={}){
    const docId=typeof context?.docId==='string'&&/^[A-Za-z][\w-]{0,127}$/.test(context.docId)?context.docId:'ah-'+(++documentSerial);
    return engine.render(looseTables(String(source??'').replace(/\r\n?/g,'\n')),{...context,docId});
  }
  function stream(source,context={}){
    const text=String(source??'').replace(/\r\n?/g,'\n');
    // References, footnotes and unfinished block math can change earlier blocks.
    // Parse these documents as a whole until the final, authoritative render.
    if(/!?\[[^\]\n]+\](?!\()|(?:^|\n)[ \t]*(?:\$\$|\\\[)/.test(text)){
      context.streamState=null;
      return render(text,context);
    }
    let state=context.streamState;
    const reset=!state||!text.startsWith(state.prefix);
    if(reset)state=context.streamState={prefix:''};
    const pending=text.slice(state.prefix.length),tokens=engine.parse(pending,{...context});
    let line=0;
    for(let index=tokens.length-1;index>=0;index--){
      if(tokens[index].level===0&&tokens[index].map){line=tokens[index].map[0];break;}
    }
    const offset=line?pending.split('\n').slice(0,line).join('\n').length+1:0;
    const completed=pending.slice(0,offset);
    state.prefix+=completed;
    return {reset,prefix:completed?render(completed,context):'',tail:render(pending.slice(offset),context)};
  }
  window.AgentHubMarkdown={
    referenceTarget,referenceHtml,referenceTextHtml,
    render,stream,
  };
})();
