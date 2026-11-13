/* Appearance and discovery entries only. These do not register executable
   agents or infer that a CLI is installed. See vendor/agent-logos/README.md. */
(() => {
  'use strict';
  const marks={qoder:['Qoder','qoder-color.svg'],openclaw:['OpenClaw','openclaw-color.svg'],hermes:['Hermes Agent','hermesagent.svg'],pi:['Pi Agent','pi.svg'],grok:['Grok','grok.svg'],kimi:['Kimi','kimi-color.svg'],minimax:['MiniMax','minimax-color.svg'],qwen:['Qwen Code','qwen-color.svg'],kiro:['Kiro','kiro-color.svg'],codebuddy:['CodeBuddy','codebuddy-color.svg'],antigravity:['Antigravity','antigravity-color.svg']};
  window.AgentHubBrandLogos=Object.freeze({...window.AgentHubBrandLogos,...Object.fromEntries(Object.entries(marks).map(([key,[name,file]])=>[key,{name,asset:'/vendor/agent-logos/'+file}]))});
  window.AgentHubAgentCatalog=Object.freeze([
    {id:'codebuddy',name:'CodeBuddy',brand:'codebuddy',aliases:['codebuddy'],description:'腾讯编程 Agent',url:'https://www.codebuddy.ai/'},
    {id:'antigravity',name:'Antigravity',brand:'antigravity',aliases:['antigravity'],description:'Google Agent 开发平台',url:'https://antigravity.google/'},
    {id:'qoder',name:'Qoder',brand:'qoder',aliases:['qoder'],description:'Qoder 编程 Agent',url:'https://qoder.com/'},
    {id:'kimi-code',name:'Kimi Code',brand:'kimi',aliases:['kimi'],description:'Kimi 终端编程 Agent',url:'https://github.com/MoonshotAI/kimi-code'},
    {id:'opencode',name:'OpenCode',brand:'opencode',aliases:['opencode'],description:'开源编程 Agent',url:'https://opencode.ai/'},
    {id:'openclaw',name:'OpenClaw',brand:'openclaw',aliases:['openclaw'],description:'个人 AI 助手与 Agent 平台',url:'https://openclaw.ai/'},
    {id:'minimax-code',name:'MiniMax Code',brand:'minimax',aliases:['minimax code','minimax-code','mcode'],description:'MiniMax 终端编程 Agent',url:'https://github.com/MiniMax-AI/minimax-code'},
    {id:'hermes',name:'Hermes',brand:'hermes',aliases:['hermes'],description:'Nous Research 的 Agent',url:'https://github.com/NousResearch/hermes-agent'},
    {id:'pi',name:'Pi',brand:'pi',aliases:['pi coding','pi agent','acp:b:pi','acp:f:pi'],description:'轻量、可扩展的编程 Agent',url:'https://github.com/earendil-works/pi'},
    {id:'grok-build',name:'Grok Build',brand:'grok',aliases:['grok'],description:'Grok 编程 Agent',url:'https://grok.com/build'},
    {id:'qwen-code',name:'Qwen Code',brand:'qwen',aliases:['qwen'],description:'Qwen 开源编程 Agent',url:'https://github.com/QwenLM/qwen-code'},
    {id:'kiro',name:'Kiro',brand:'kiro',aliases:['kiro'],description:'Kiro 编程 Agent',url:'https://kiro.dev/'}
  ].map(item=>Object.freeze(item)));
})();
