'use strict';
require('./brand.cjs');
// Foreground launcher: mirror server output to the console and append-only log.
// Never terminate an existing listener or automatically install dependencies.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');

function reserveCheck(host, port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({host,port,exclusive:true}, () => {
      const actual = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(actual));
    });
  });
}
function health(host, port) {
  return new Promise(resolve => {
    const req = http.get({hostname:host,port,path:'/api/health',headers:process.env.AGENTHUB_TOKEN ? {'x-agenthub-token':process.env.AGENTHUB_TOKEN} : {}}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      res.once('end', () => { let data=null; try { data=JSON.parse(body); } catch {} resolve({status:res.statusCode,data}); });
      res.once('error', () => resolve(null));
    });
    req.setTimeout(1200, () => req.destroy());
    req.once('error', () => resolve(null));
  });
}
async function run() {
  const root = path.resolve(__dirname,'..'), env = process.env;
  const host = env.AGENTHUB_HOST || '127.0.0.1', requestedPort = Number(env.AGENTHUB_PORT || 7261);
  const dataDir = path.resolve(root,env.AGENTHUB_DATA_DIR || 'data'), logFile = path.join(dataDir,'logs','server.log');
  let log, logBroken=false;
  try {
    fs.mkdirSync(path.dirname(logFile),{recursive:true});
    log=fs.createWriteStream(logFile,{fd:fs.openSync(logFile,'a'),autoClose:true});
  } catch (error) {
    console.error('[ERROR] 无法写入启动日志：'+logFile+' ('+(error.code || error.message)+')');
    return 1;
  }
  log.on('error',error=>{logBroken=true;console.error('[ERROR] 日志写入失败，屏幕输出仍会保留：'+error.message);});
  const write=(chunk,stderr=false)=>{(stderr ? process.stderr : process.stdout).write(chunk);if(!logBroken) log.write(chunk);};
  const line=(stage,message)=>write('['+new Date().toLocaleTimeString('zh-CN',{hour12:false})+'] ['+stage+'] '+message+'\n');
  const finishLog=code=>new Promise(resolve=>{if(logBroken){log.destroy();resolve(code);}else log.end(()=>resolve(code));});
  write('\n--- OrbitCell '+new Date().toLocaleString('zh-CN',{hour12:false})+' ---\n');
  line('启动','工作目录：'+root);
  line('环境','Node '+process.version+' · '+process.execPath);
  let version='unknown';try{version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version||version;}catch{}
  line('版本','OrbitCell '+version+' · '+process.platform+'/'+process.arch+' · 启动器 PID '+process.pid);
  line('主机',os.cpus().length+' 核 CPU · 可用内存 '+(os.freemem()/1024**3).toFixed(1)+' / '+(os.totalmem()/1024**3).toFixed(1)+' GB');
  line('数据','运行数据目录：'+dataDir);
  line('工作区',env.AGENTHUB_WORKSPACE ? path.resolve(root,env.AGENTHUB_WORKSPACE) : '使用服务默认工作区（就绪后确认）');
  line('访问','监听 '+host+':'+requestedPort+' · 访问令牌'+(env.AGENTHUB_TOKEN?'已配置（不打印）':'未配置'));
  line('网络',['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'].some(key=>!!env[key])?'检测到显式代理环境配置（不打印地址或凭据）':'未检测到显式代理环境配置，服务会检查系统网络设置');
  line('日志','屏幕实时输出，同时追加到 '+logFile);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<22 || major===22 && minor<19){line('ERROR','需要 Node.js 22.19 或更新版本。');return finishLog(1);}
  line('检查 1/3','Node.js 版本符合要求');
  if(!Number.isInteger(requestedPort) || requestedPort<0 || requestedPort>65535){line('ERROR','AGENTHUB_PORT 必须是 0 到 65535 之间的整数。');return finishLog(1);}
  if(!fs.existsSync(path.join(root,'server.js'))){line('ERROR','未找到 server.js，请将启动脚本保留在 OrbitCell 项目目录。');return finishLog(1);}
  let port;
  try { port=await reserveCheck(host,requestedPort); }
  catch(error){
    line('ERROR',error.code==='EADDRINUSE' ? '端口 '+host+':'+requestedPort+' 已被占用，未再启动第二个服务。' : '无法监听 '+host+':'+requestedPort+'：'+(error.code || error.message));
    if(error.code==='EADDRINUSE') line('提示','如需重启，请先在原服务窗口按 Ctrl+C，再运行启动脚本。');
    return finishLog(1);
  }
  line('检查 2/3','监听地址可用：'+host+':'+port);
  line('启动 3/3','正在初始化服务，后续服务输出会显示在这里…');
  line('命令',process.execPath+' '+path.join(root,'server.js'));
  const probeHost=host==='0.0.0.0' ? '127.0.0.1' : host==='::' ? '::1' : host;
  const url='http://'+(probeHost.includes(':') ? '['+probeHost+']' : probeHost)+':'+port;
  return new Promise(resolve=>{
    const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...env,AGENTHUB_PORT:String(port)},windowsHide:true,stdio:['inherit','pipe','pipe']});
    let closed=false,ready=false,timer=null,warned=false,signalled=false,lastProgress=Date.now(),probes=0;
    const started=Date.now();
    const onInterrupt=()=>{
      if(closed || signalled) return;signalled=true;
      line('停止','收到 Ctrl+C，等待服务退出并保存数据…');
      // Windows broadcasts Ctrl+C to both console processes. kill(SIGINT)
      // there would force-terminate the child instead of its shutdown handler.
      if(process.platform!=='win32') child.kill('SIGINT');
    };
    const onTerminate=()=>{if(!closed) child.kill('SIGTERM');};
    process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);
    const finish=async(code,message)=>{
      if(closed) return;closed=true;clearTimeout(timer);
      process.removeListener('SIGINT',onInterrupt);process.removeListener('SIGTERM',onTerminate);
      line(code===0 ? 'STOP' : 'ERROR',message);
      if(code!==0) line('日志','完整输出已保留：'+logFile);
      resolve(await finishLog(code));
    };
    child.once('spawn',()=>line('进程','服务 PID '+child.pid+'；窗口保持运行，按 Ctrl+C 停止'));
    // Honor both sinks' backpressure so a slow console/disk cannot build an
    // unbounded queue in this launcher during a burst of server output.
    const mirror=(source,destination)=>source.on('data',chunk=>{
      source.pause();let pending=logBroken ? 1 : 2;
      const drained=()=>{if(--pending===0 && !closed) source.resume();};
      destination.write(chunk,drained);if(!logBroken) log.write(chunk,drained);
    });
    mirror(child.stdout,process.stdout);mirror(child.stderr,process.stderr);
    child.once('error',error=>finish(1,'无法启动 Node 服务：'+error.message));
    child.once('close',(code,signal)=>finish(Number.isInteger(code) ? code : signal==='SIGINT' ? 0 : 1,'服务已退出 · '+(signal ? '信号 '+signal : '退出码 '+code)));
    async function poll(){
      if(closed || ready) return;
      probes++;const result=await health(probeHost,port);if(closed) return;
      if(result && (result.status===200 && result.data && typeof result.data==='object' || result.status===401 || result.status===403)){
        ready=true;
        line('READY','服务已响应：'+url+(result.status===200 ? ' · 健康检查通过' : ' · HTTP '+result.status+'，请登录或使用访问令牌'));
        line('就绪','初始化用时 '+((Date.now()-started)/1000).toFixed(2)+' 秒 · 健康检查 '+probes+' 次 · 服务 PID '+child.pid);
        if(typeof result.data?.defaultWorkspace==='string')line('工作区',result.data.defaultWorkspace);
        line('使用','浏览器打开 '+url+'；当前窗口持续输出日志；Ctrl+C 停止服务');
        const features=[];
        if(Number.isFinite(result.data?.gitStatus?.version)) features.push('Git 行数 v'+result.data.gitStatus.version);
        if(Number.isFinite(result.data?.resourceMonitor?.version)) features.push('资源监控 v'+result.data.resourceMonitor.version+(result.data.resourceMonitor.ssh ? '（支持 SSH）' : ''));
        if(features.length) line('已加载',features.join(' · '));
        return;
      }
      if(!warned && Date.now()-started>=30000){warned=true;line('等待','30 秒内尚未通过就绪检查，服务进程仍在运行，请查看上面的输出。');}
      if(Date.now()-lastProgress>=10000){lastProgress=Date.now();line('初始化','已等待 '+Math.round((Date.now()-started)/1000)+' 秒 · 健康检查 '+probes+' 次 · '+(result?'HTTP '+result.status:'尚未响应')+' · 服务 PID '+child.pid);}
      timer=setTimeout(poll,warned ? 5000 : 500);
    }
    poll();
  });
}
module.exports={run};
if(require.main===module) run().then(code=>{process.exitCode=code;}).catch(error=>{console.error('[ERROR] 启动器失败：'+error.message);process.exitCode=1;});
