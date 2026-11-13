const browsers = require('./browser-cdp');
const { fail } = require('./workflow-store');
const fs = require('fs/promises'), path = require('path'), crypto = require('crypto');
const { DATA_DIR } = require('./store');
function mount(app, session, enabled) {
  app.use('/api/browser', async (req, res, next) => {
    const id = req.body?.sessionId || req.query.sessionId;
    if (!id) return next();
    try {
      if (!session(id)) fail('会话不存在', 404);
      if (!enabled(session(id))) fail('此任务的浏览器工具已停用', 403);
      const readOps = ['status', 'frame', 'diagnostics', 'pages'];
      const op = req.path.slice(1); if (readOps.includes(op) ? req.method !== 'GET' : req.method !== 'POST') return next();
      const owner = browsers.forSession(id), a = req.body || {}, pageId = a.pageId || req.query.pageId;
      if (pageId != null && (typeof pageId !== 'string' || pageId.length > 80)) fail('浏览器标签 ID 无效', 400);
      const b = pageId && !['page-close', 'page-new'].includes(op) ? owner.forPage(pageId) : owner;
      const operations = {
        status: () => b.status(), frame: () => b.frame({ width: req.query.width, height: req.query.height }), diagnostics: () => ({ entries: b.diagnostics() }),
        pages: () => ({ pages: owner.status().pages, version: 2 }),
        'page-new': async () => ({ ok: true, page: await owner.newPage(a) }),
        'page-close': () => { if (!pageId) fail('缺少浏览器标签 ID', 400); return owner.closePage(pageId, a); },
        navigate: () => b.navigate(a.direction, a),
        open: async () => ({ ok: true, page: await b.open(a.url, a) }), snapshot: async () => ({ ok: true, page: await b.snapshot(a) }),
        click: () => b.click(a.selector, a), type: () => b.typeText(a.selector, a.text, a), evaluate: () => b.evaluateJs(a.expression, a),
        claim: () => b.claim(a.mode, a.controllerToken), pointer: () => b.pointer(a), keyboard: () => b.keyboard(a), pick: () => b.pick(a),
        recording: () => b.recordActions(a.enabled), close: async () => { await browsers.closeSession(id); return { ok: true }; },
        screenshot: async () => { const shot = await b.screenshotBase64(a), dir = path.join(DATA_DIR, 'uploads'), name = 'browser-' + crypto.randomUUID() + '.png'; await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, name), Buffer.from(shot.base64, 'base64'), { flag: 'wx' }); return { ok: true, image: '/uploads/' + name, path: path.join(dir, name), url: shot.url }; },
      };
      if (!operations[op]) return next(); res.setHeader('Cache-Control','no-store'); res.json(await operations[op]());
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
}
module.exports = { mount };
