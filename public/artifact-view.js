/* Resize only the originating opaque artifact frame. No document content crosses. */
window.AgentHubArtifactView=(()=>{
  const sources=new WeakMap();
  function mount(frame,html){
    const mode=window.AgentHubConversationPreferences.read().artifactFit,nonce=crypto.randomUUID();sources.set(frame,{html,mode});frame.dataset.artifactSizing=nonce;frame.dataset.artifactFit=mode;
    frame.style.height='440px';
    if(mode!=='fit'){frame.srcdoc=html;return;}
    const styles='<style>html{height:auto!important;overflow:auto}body{min-height:0!important;height:auto!important}svg{max-width:100%;height:auto}img{max-width:100%}</style>';
    const bridge=`<script>(()=>{let queued=false;const report=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;const b=document.body;const height=Math.ceil(Math.max(b?.scrollHeight||0,b?.getBoundingClientRect().height||0));parent.postMessage({type:'agenthub-artifact-size',nonce:${JSON.stringify(nonce)},height},'*');});};new ResizeObserver(report).observe(document.body||document.documentElement);addEventListener('load',report);addEventListener('resize',report);report();})();<\/script>`;
    frame.srcdoc=html+styles+bridge;
  }
  window.addEventListener('message',event=>{
    if(event.data?.type!=='agenthub-artifact-size'||!Number.isFinite(event.data.height))return;
    for(const frame of document.querySelectorAll('iframe[data-artifact-sizing]')){
      if(event.source!==frame.contentWindow||frame.dataset.artifactSizing!==event.data.nonce||frame.dataset.artifactFit!=='fit')continue;
      const height=Math.max(120,Math.min(3200,Math.ceil(event.data.height)));
      if(frame.clientHeight!==height){const style=getComputedStyle(frame),border=style.boxSizing==='border-box'?(parseFloat(style.borderTopWidth)||0)+(parseFloat(style.borderBottomWidth)||0):0;frame.style.height=(height+border)+'px';}
    }
  });
  function refresh(){for(const frame of document.querySelectorAll('iframe[data-artifact-sizing]')){const source=sources.get(frame);if(source&&source.mode!==window.AgentHubConversationPreferences.read().artifactFit)mount(frame,source.html);}}
  return {mount,refresh};
})();
