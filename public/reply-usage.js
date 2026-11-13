/* One read-only popover; all rows use their own label/value layout. */
(()=>{
  let anchor=null;
  function close(focus=false){
    document.getElementById('replyUsagePopover')?.remove();
    if(anchor?.isConnected){anchor.setAttribute('aria-expanded','false');if(focus)anchor.focus({preventScroll:true});}
    anchor=null;
  }
  function element(tag,className,text){const node=document.createElement(tag);node.className=className;if(text!=null)node.textContent=text;return node;}
  function show(button){
    const source=button.closest('.turn-tail')?.querySelector('.turn-metrics');if(!source)return;
    let usage;try{usage=JSON.parse(button.dataset.replyUsage);}catch{}
    if(!usage||typeof usage!=='object')usage={known:false};
    const field=selector=>{const node=source.querySelector(selector);return node?{text:node.textContent.trim(),title:node.getAttribute('title')||''}:null;};
    const panel=element('section','reply-usage-popover');panel.id='replyUsagePopover';panel.setAttribute('role','region');panel.setAttribute('aria-label','本轮用量明细');
    const heading=element('header','reply-usage-heading'),name=element('span','reply-usage-heading-label','本轮用量');
    const symbol=button.querySelector('svg')?.cloneNode(true);if(symbol)name.prepend(symbol);
    const total=element('span','reply-usage-total');total.append(element('strong','',usage.known?(usage.estimated?'≈':'')+Number(button.dataset.total||0).toLocaleString():'未上报'));if(usage.known)total.append(element('span','reply-usage-unit','tok'));
    heading.append(name,total);panel.append(heading);
    function row(list,label,text,unit='',key='',note=''){
      const item=element('div','reply-usage-row');if(key)item.dataset.usageField=key;if(note)item.title=note;
      const value=element('dd','reply-usage-value');value.append(element('span','reply-usage-number',text));if(unit)value.append(element('span','reply-usage-unit',unit));
      item.append(element('dt','reply-usage-label',label),value);list.append(item);return item;
    }
    const model=field('.turn-model'),cache=field('.turn-metric-cache'),cacheText=source.querySelector('.turn-metric-cache strong')?.textContent.trim()||'未记录';
    const identity=element('dl','reply-usage-identity');if(model)row(identity,'模型',model.text,'','model',model.title);panel.append(identity);
    const cacheSection=element('section','reply-usage-cache');cacheSection.dataset.usageField='cache';const cacheList=element('dl','reply-usage-list');row(cacheList,'缓存命中',cacheText,'','',cache?.title);cacheSection.append(cacheList);
    const hit=Number.parseFloat(cacheText.replace('≈',''));
    if(Number.isFinite(hit)){const track=element('div','reply-usage-cache-track');track.setAttribute('aria-hidden','true');const fill=element('span','');fill.style.width=Math.max(0,Math.min(100,hit))+'%';track.append(fill);cacheSection.append(track);}
    panel.append(cacheSection);
    const tokens=element('dl','reply-usage-list reply-usage-tokens');
    for(const [label,key,value]of [['未缓存输入','input',usage.input],['缓存读取','cacheAmounts',usage.cacheKnown?usage.cacheRead:undefined],['缓存写入','cacheAmounts',usage.cacheKnown?usage.cacheCreate:undefined],['输出','output',usage.output]]){
      const known=usage.known&&Number.isFinite(value)&&value>=0;row(tokens,label,known?value.toLocaleString():'未上报',known?'tok':'',key);
    }
    panel.append(tokens);
    const performance=element('dl','reply-usage-list reply-usage-performance');
    const requests=field('.turn-metric-requests strong'),duration=field('.turn-metric-duration'),rate=field('.turn-metric-rate');
    if(requests)row(performance,'请求次数',requests.text,'','requests');
    if(duration)row(performance,'整轮用时',duration.text,'','duration',duration.title);
    if(rate){const match=rate.text.match(/^(请求均速|回合均速|整轮均速)\s+(.+)$/);row(performance,match?.[1]||'输出均速',match?.[2]||rate.text,'','rate',rate.title);}
    if(performance.children.length)panel.append(performance);
    const warning=field('.pill-warn');if(warning)panel.append(element('p','reply-usage-note',warning.text));
    if(button.dataset.live==='true'||usage.partial||usage.estimated)panel.append(element('p','reply-usage-note',[button.dataset.live==='true'?'运行中，仅累计已完成并上报的请求。':'',usage.partial?'部分请求未完整上报，以上仅包含已记录用量。':'',usage.estimated?'Token 含估算值。':''].filter(Boolean).join(' ')));
    document.body.append(panel);anchor=button;button.setAttribute('aria-expanded','true');
    const zoom=Number(document.body.style.zoom)||1,rect=button.getBoundingClientRect(),width=innerWidth/zoom,height=innerHeight/zoom;
    panel.style.maxWidth=Math.max(0,width-24)+'px';panel.style.maxHeight=Math.max(0,height-24)+'px';
    const bounds=panel.getBoundingClientRect(),gap=8,margin=12;
    panel.style.left=Math.max(margin,Math.min(rect.left/zoom,width-bounds.width/zoom-margin))+'px';
    const above=Math.max(0,rect.top/zoom-margin-gap),below=Math.max(0,height-rect.bottom/zoom-margin-gap);
    const useAbove=bounds.height/zoom<=above||above>=below;
    panel.style.maxHeight=(useAbove?above:below)+'px';
    const actualHeight=panel.getBoundingClientRect().height/zoom;
    panel.style.top=Math.max(margin,useAbove?rect.top/zoom-actualHeight-gap:rect.bottom/zoom+gap)+'px';
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-reply-usage]');if(!button){if(!event.target.closest('#replyUsagePopover'))close();return;}const repeated=anchor===button;close();if(!repeated)show(button);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.getElementById('replyUsagePopover')){event.preventDefault();event.stopPropagation();close(true);}},true);
  document.addEventListener('scroll',event=>{if(event.target?.id==='messages')close();},true);
  document.addEventListener('reply-usage-update',event=>{
    if(!anchor||!event.target.contains(anchor))return;
    const button=anchor,top=document.getElementById('replyUsagePopover')?.scrollTop||0;
    close();show(button);
    const panel=document.getElementById('replyUsagePopover');if(panel)panel.scrollTop=top;
  });
  window.addEventListener('resize',()=>close());
})();
