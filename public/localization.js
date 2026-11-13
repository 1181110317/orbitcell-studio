(() => {
  const pairs = [
    ['新会话','New chat','محادثة جديدة'],['新建会话','New chat','محادثة جديدة'],['新建任务','New task','مهمة جديدة'],['工作台','Workbench','مساحة العمل'],['收件箱','Inbox','صندوق الوارد'],['工具箱','Toolbox','الأدوات'],['设置','Settings','الإعدادات'],['文件','Files','الملفات'],['变更','Changes','التغييرات'],['对比','Compare','مقارنة'],['运行','Running','قيد التشغيل'],['子代理','Subagents','الوكلاء الفرعيون'],['会话用量','Chat usage','استخدام المحادثة'],['本机终端','Local terminal','طرفية محلية'],['用量统计','Usage','الاستخدام'],['API 管理','API settings','إعدادات API'],['定时任务','Scheduled tasks','المهام المجدولة'],['侧栏','Sidebar','الشريط الجانبي'],['目录','Directory','المجلد'],['助手','Assistant','المساعد'],['位置','Location','الموقع'],['本机','Local','محلي'],['模型','Model','النموذج'],['默认','Default','افتراضي'],['权限','Permissions','الصلاحيات'],['自动','Auto','تلقائي'],['供应商','Provider','المزود'],['推理','Reasoning','الاستدلال'],['发送','Send','إرسال'],['发送消息','Send message','إرسال رسالة'],['停止','Stop','إيقاف'],['深度思考','Deep reasoning','تفكير عميق'],['清屏','Clear terminal','مسح الطرفية'],['终端','Terminal','الطرفية'],['关闭','Close','إغلاق'],['保存','Save','حفظ'],['取消','Cancel','إلغاء'],['刷新','Refresh','تحديث'],['删除','Delete','حذف'],['编辑','Edit','تعديل'],['新建','New','جديد'],['添加','Add','إضافة'],['启用','Enabled','مفعّل'],['停用','Disabled','معطّل'],['名称','Name','الاسم'],['状态','Status','الحالة'],['全部','All','الكل'],['搜索','Search','بحث'],['导出','Export','تصدير'],['复制','Copy','نسخ'],['导入','Import','استيراد'],['应用','Apply','تطبيق'],['重试','Retry','إعادة المحاولة'],['查看','View','عرض'],['移除','Remove','إزالة'],['开始','Start','بدء'],['完成','Done','مكتمل'],['失败','Failed','فشل'],['运行中','Running','قيد التشغيل'],['待执行','Waiting','بانتظار التنفيذ'],['已取消','Cancelled','ملغى'],['已完成','Completed','مكتمل'],['暂停','Paused','متوقف مؤقتاً'],['进行中','Active','نشط'],['待发送','Queued','في قائمة الانتظار'],['立即发送','Send now','إرسال الآن'],['优先发送','Send next','إرسال تالياً'],['暂停队列','Pause queue','إيقاف قائمة الانتظار'],['恢复队列','Resume queue','استئناف قائمة الانتظار'],['展开','Expand','توسيع'],['收起','Collapse','طي'],['历史','History','السجل'],['结果','Result','النتيجة'],['运行配置','Runtime settings','إعدادات التشغيل'],['开发流程','Development workflows','سير التطوير'],['工作环境','Workspace','بيئة العمل'],['终端管理','Terminal manager','إدارة الطرفيات'],['分支与 Stash','Branches and stash','الفروع والتخزين المؤقت'],['PR 工作台','Pull requests','طلبات الدمج'],['仓库托管平台','Code hosting','استضافة المستودعات'],['交接 Agent','Agent handoff','تسليم المهمة'],['交接给其他 Agent','Hand off to another agent','التسليم لوكيل آخر'],['目标 Agent','Target agent','الوكيل المستهدف'],['预览上下文','Preview context','معاينة السياق'],['确认交接','Confirm handoff','تأكيد التسليم'],['团队与子任务','Team and subtasks','الفريق والمهام الفرعية'],['任务正文','Task prompt','نص المهمة'],['创建子任务','Create subtask','إنشاء مهمة فرعية'],['创建并执行','Create and run','إنشاء وتشغيل'],['角色','Role','الدور'],['负责人','Owner','المسؤول'],['任务信箱','Task mailbox','بريد المهمة'],['收件任务','Recipient task','المهمة المستلمة'],['发送任务消息','Send task message','إرسال رسالة للمهمة'],['标为已读','Mark read','تحديد كمقروء'],['查看会话','Open chat','فتح المحادثة'],['持续目标','Persistent goal','الهدف المستمر'],['目标与验收条件','Goal and acceptance criteria','الهدف ومعايير القبول'],['最多回合','Maximum turns','الحد الأقصى للجولات'],['清除','Clear','مسح'],['保存目标','Save goal','حفظ الهدف'],['保存并开始','Save and start','حفظ وبدء'],['事件触发任务','Event triggered tasks','مهام الأحداث'],['事件来源','Event source','مصدر الحدث'],['目标任务','Target task','المهمة المستهدفة'],['触发任务正文','Triggered task prompt','نص مهمة الحدث'],['冷却秒数','Cooldown seconds','ثواني الانتظار'],['启用此触发器','Enable trigger','تفعيل المشغّل'],['更新签名密钥','Rotate signing secret','تغيير مفتاح التوقيع'],['共享浏览器','Shared browser','المتصفح المشترك'],['实时画面','Live view','عرض مباشر'],['用户接管','Human control','تحكم المستخدم'],['交还 Agent','Return to agent','إعادة التحكم للوكيل'],['元素选择','Element picker','اختيار عنصر'],['诊断','Diagnostics','التشخيص'],['操作记录','Action recording','سجل العمليات'],['交互 HTML 成果','Interactive HTML artifacts','نتائج HTML تفاعلية'],['语音转写','Speech transcription','تحويل الصوت إلى نص'],['项目初始化与准备','Project setup','إعداد المشروع'],['克隆仓库','Clone repository','استنساخ المستودع'],['仓库地址','Repository URL','عنوان المستودع'],['上级目录','Parent directory','المجلد الأصل'],['新目录名','New directory name','اسم المجلد الجديد'],['克隆并显示进度','Clone with progress','استنساخ مع عرض التقدم'],['当前项目','Current project','المشروع الحالي'],['项目目录','Project directory','مجلد المشروع'],['初始分支','Initial branch','الفرع الأول'],['初始化 Git','Initialize Git','تهيئة Git'],['预览准备命令','Preview setup commands','معاينة أوامر الإعداد'],['进度与结果','Progress and results','التقدم والنتائج'],['创建 GitHub 仓库','Create GitHub repository','إنشاء مستودع GitHub'],['预览并发布','Preview and publish','معاينة ونشر'],['本地扩展','Local extensions','الإضافات المحلية'],['语言与主题','Language and theme','اللغة والمظهر'],['界面语言','UI language','لغة الواجهة'],['扩展主题','Extension theme','مظهر الإضافة'],['使用原有主题','Use current theme','استخدام المظهر الحالي'],['导入本地扩展','Import local extension','استيراد إضافة محلية'],['清单文件路径','Manifest file path','مسار ملف الإضافة'],['重新加载','Reload','إعادة تحميل'],['查看提示词','View prompt','عرض التوجيه'],['配置托管平台','Configure code host','إعداد الاستضافة'],['保存配置','Save configuration','حفظ الإعدادات'],['打开 PR 工作台','Open pull requests','فتح طلبات الدمج'],['平台','Platform','المنصة'],['API 根地址','API base URL','عنوان API الأساسي'],['仓库路径或 ID','Repository path or ID','مسار المستودع أو معرّفه'],['检查与合并状态','Checks and merge status','الفحوصات وحالة الدمج'],['评论与审查草稿','Comments and review draft','التعليقات ومسودة المراجعة'],['普通评论','Comment','تعليق'],['批准','Approve','موافقة'],['要求修改','Request changes','طلب تغييرات'],['提交','Submit','إرسال'],['PR 列表','Pull request list','قائمة طلبات الدمج'],['开放','Open','مفتوح'],['已合并','Merged','مدمج'],['已关闭','Closed','مغلق'],['草稿','Draft','مسودة'],['保存标题与说明','Save title and description','حفظ العنوان والوصف'],['关闭 PR','Close pull request','إغلاق طلب الدمج'],['重新打开','Reopen','إعادة فتح'],['合并','Merge','دمج'],['用户名','Username','اسم المستخدم'],['密码','Password','كلمة المرور'],['登录','Log in','تسجيل الدخول'],['搜索会话 / 消息…','Search chats / messages…','بحث في المحادثات والرسائل…'],['搜索会话 / 消息','Search chats / messages','بحث في المحادثات والرسائل'],['消息内容','Message text','نص الرسالة'],['切换主题','Change theme','تغيير المظهر'],['更多会话操作','More chat actions','خيارات المحادثة'],['批量操作','Bulk actions','عمليات جماعية'],['会话内搜索','Search in chat','بحث في المحادثة'],['查找内容','Search text','نص البحث'],['在本会话中查找…','Find in this chat…','بحث في هذه المحادثة…'],['回到底部','Scroll to bottom','الانتقال للأسفل'],['添加图片附件','Attach images','إرفاق صور']
  ];
  const english = {...Object.fromEntries(pairs.map(p => [p[0], p[1]])), ...window.OrbitCellLocaleEnglish}, arabic = Object.fromEntries(pairs.map(p => [p[0], p[2]]));
  const builtins = [{ id: 'zh-CN', name: '简体中文', dir: 'ltr', dictionary: {} }, { id: 'en', name: 'English', dir: 'ltr', dictionary: english }, { id: 'ar', name: 'العربية', dir: 'rtl', dictionary: arabic }];
  let extra = [], selected = storageGet('ah.locale') || 'zh-CN', scheduled = false;
  const texts = new WeakMap(), attrs = new WeakMap();
  const excluded = 'script,style,pre,code,textarea,iframe,[contenteditable],#messages,#sessionList,#sessionTabs,#hdrTitle,#providerLabel,#modelLabel,#termPanel,#queueTray .queue-text,#attachStrip,#mentionMenu,.workflow-transcript,.scm-discussion,.feature-diff,.feature-log,[data-i18n-ignore]';
  const languages = () => [...builtins.map(b => ({ ...b, dictionary: Object.assign({}, b.dictionary, ...extra.filter(l => l.id === b.id).map(l => l.dictionary)) })), ...extra.filter(l => !builtins.some(b => b.id === l.id))];
  const catalog = () => [{id:'auto',name:'跟随系统 / System',dir:'ltr'},...languages()];
  let language=null;
  function preferredLanguage() {
    if(selected!=='auto')return selected;
    for(const name of navigator.languages?.length?navigator.languages:[navigator.language||'']){
      const normalized=String(name).toLowerCase();
      const match=languages().find(l=>l.id.toLowerCase()===normalized)||languages().find(l=>l.id.toLowerCase().split('-')[0]===normalized.split('-')[0]);
      if(match)return match.id;
    }
    return 'en';
  }
  const current = () => language ||= languages().find(l => l.id === preferredLanguage()) || builtins[1];
  const patterns = [
    [/^已选 (\d+) \/ (\d+)$/, 'Selected $1 / $2'],
    [/^(\d+) 个供应商$/, '$1 providers'],[/^(\d+) 个已添加模型$/, '$1 added models'],[/^(\d+) 个已添加$/, '$1 added'],
    [/^(\d+) 个目录模型$/, '$1 catalog models'],[/^(\d+) 个模型入口$/, '$1 model entries'],
    [/^(\d+) 个 Agent · (\d+) 个会话$/, '$1 Agents · $2 chats'],[/^(\d+) 个会话$/, '$1 chats'],
    [/^(\d+) 项$/, '$1 items'],[/^(\d+) \/ (\d+) 项$/, '$1 / $2 items'],[/^共 (\d+) 项$/, '$1 items'],
    [/^显示 (\d+) \/ (\d+) 个模型入口$/, 'Showing $1 / $2 model entries'],
    [/^已选 (\d+) 个$/, '$1 selected'],[/^显示全部 (\d+) 个$/, 'Show all $1'],
    [/^(\d+) 台已配置主机$/, '$1 configured hosts'],[/^(\d+) 个已配置服务器$/, '$1 configured servers'],
    [/^(\d+) 秒$/, '$1 seconds'],[/^(\d+) 条$/, '$1 messages'],[/^(\d+) 小时$/, '$1 hours'],
    [/^全部设置 · (\d+) 项结果$/, 'All settings · $1 results'],
    [/^(\d+) 个已添加 · 目录共 (\d+) 个 · 自动识别协议$/, '$1 added · $2 catalog models · Automatic protocol'],
    [/^(\d{1,2}:\d{2}) 更新$/, 'Updated $1'],[/^已用 (.+) \/ (.+)$/, 'Used $1 / $2'],
  ];
  function translate(source, params) {
    source=String(source??'');
    const lang = current(); if (lang.id === 'zh-CN') return params?source.replace(/\{(\w+)\}/g,(all,name)=>Object.hasOwn(params,name)?String(params[name]):all):source;
    if(!source.trim())return source;
    const value = source.trim(), match = /^([^A-Za-z0-9\u3400-\u9fff]*)([\s\S]*)$/.exec(value), prefix = match?.[1] || '', key = match?.[2] || value;
    const dictionary = lang.dictionary || {};
    let result = Object.hasOwn(dictionary, value) ? dictionary[value] : Object.hasOwn(dictionary, key) ? prefix + dictionary[key] : Object.hasOwn(english, value) ? english[value] : Object.hasOwn(english, key) ? prefix + english[key] : value;
    if(result===value)for(const [pattern,replacement]of patterns)if(pattern.test(key)){result=prefix+key.replace(pattern,replacement);break;}
    if(params)result=result.replace(/\{(\w+)\}/g,(all,name)=>Object.hasOwn(params,name)?String(params[name]):all);
    return source.slice(0, source.indexOf(value)) + result + source.slice(source.indexOf(value) + value.length);
  }
  function sourceText(root, omit='') {
    if(!root)return '';
    if(root.nodeType===3){const prior=texts.get(root);return prior&&root.nodeValue===prior.output?prior.source:root.nodeValue;}
    if(omit&&root.matches?.(omit))return '';
    return [...root.childNodes].map(node=>sourceText(node,omit)).join('');
  }
  function applyRoot(root) {
    if(!root?.isConnected)return;
    const textNode=node=>{if(!node.parentElement||node.parentElement.closest(excluded))return;const prior=texts.get(node),source=prior&&node.nodeValue===prior.output?prior.source:node.nodeValue,output=translate(source);texts.set(node,{source,output});if(node.nodeValue!==output)node.nodeValue=output;};
    if(root.nodeType===3){textNode(root);return;}
    if(root.closest?.(excluded)&&!root.matches('input,textarea'))return;
    // Reject entire conversation/code subtrees, not just their text nodes.
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{acceptNode:node=>node.nodeType===1?(node.matches(excluded)?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_SKIP):NodeFilter.FILTER_ACCEPT});
    while(walker.nextNode())textNode(walker.currentNode);
    const selector='[title],[aria-label],[placeholder],[aria-valuetext]';
    for (const element of [...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)]) {
      if (element.closest(excluded) && !element.matches('textarea,input')) continue;
      const values = attrs.get(element) || {};
      for (const name of ['title','aria-label','placeholder','aria-valuetext']) { if (!element.hasAttribute(name)) continue; const raw = element.getAttribute(name), prior = values[name], source = prior && raw === prior.output ? prior.source : raw, output = translate(source); values[name] = { source, output }; if (raw !== output) element.setAttribute(name, output); } attrs.set(element, values);
    }
  }
  const options={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder','aria-valuetext']},dirty=new Set();
  const observer=new MutationObserver(records=>{
    if(current().id==='zh-CN')return;
    for(const record of records){const el=record.target.nodeType===1?record.target:record.target.parentElement;if(!el||el.closest(excluded)&&!(record.type==='attributes'&&el.matches('input,textarea')))continue;if(record.type==='childList'){for(const node of record.addedNodes)dirty.add(node);}else dirty.add(record.target);}
    if(dirty.size&&!scheduled){scheduled=true;setTimeout(()=>{scheduled=false;observer.disconnect();try{for(const root of dirty)applyRoot(root);}finally{dirty.clear();observer.observe(document.body,options);}},30);}
  });
  function apply(){dirty.clear();observer.disconnect();try{document.documentElement.lang=current().id;document.documentElement.dir=current().dir||'ltr';applyRoot(document.body);for(const label of document.querySelectorAll('#sessionList [data-i18n-text]'))label.textContent=translate(label.dataset.i18nText);}finally{observer.observe(document.body,options);}}
  function changed(){apply();document.dispatchEvent(new CustomEvent('orbitcell:locale-changed',{detail:{preference:selected,language:current().id}}));}
  window.AgentHubLocale = {catalog,translate,sourceText,set(id){if(!catalog().some(l=>l.id===id))return false;selected=id;language=null;storageSet('ah.locale',id);changed();return true;},get id(){return current().id;},get preference(){return selected;},get selection(){return catalog().some(l=>l.id===selected)?selected:current().id;},extend(values){extra=Array.isArray(values)?values:[];language=null;changed();},apply};
  window.addEventListener('languagechange',()=>{if(selected==='auto'){language=null;changed();}});
  window.addEventListener('storage',event=>{if(event.key==='ah.locale'){selected=event.newValue||'zh-CN';language=null;changed();}});
  document.addEventListener('orbitcell:locale-changed',()=>{
    for(const select of document.querySelectorAll('[data-ui-locale]')){
      const entries=catalog();
      if(JSON.stringify([...select.options].map(o=>[o.value,o.textContent]))!==JSON.stringify(entries.map(l=>[l.id,l.name])))select.replaceChildren(...entries.map(item=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.name;option.setAttribute('data-i18n-ignore','');return option;}));
      select.value=window.AgentHubLocale.selection;
    }
    for(const select of document.querySelectorAll('select[data-custom-select="true"]')){select.syncControl?.();applyRoot(select.nextElementSibling);}
  });
  document.documentElement.lang=current().id;document.documentElement.dir=current().dir||'ltr';
  if(current().id!=='zh-CN')apply();else observer.observe(document.body,options);
})();
