<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="public/brand.svg" alt="OrbitCell" width="64">

<h1>OrbitCell Studio</h1>

<p><strong>统一 AI 智能体开发工作空间</strong><br>AI Agent Development Workspace</p>
<p>One Orbit. Infinite Possibilities.</p>
<p>Unify Agents, Models, Tools and Workflows.</p>

<p>Claude Code · Codex · ZCode · DeepSeek Harness · Gemini CLI · OpenCode · WorkBuddy · Cursor ACP · 自定义 Agent</p>

<p>
  <a href="https://github.com/1181110317/orbitcell-studio"><img alt="GitHub" src="https://img.shields.io/badge/github-1181110317%2Forbitcell-studio-24292f?logo=github"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=node.js&logoColor=white">
  <img alt="许可证" src="https://img.shields.io/badge/license-ISC-blue">
  <img alt="平台" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?logo=windows">
</p>

</div>

<p align="center">
  <a href="docs/assets/orbitcell-agents.png"><img src="docs/assets/orbitcell-agents.png" alt="OrbitCell Studio Agent 管理：紧凑卡片、运行版本、环境与模型设置" width="92%"></a>
</p>

OrbitCell Studio 是一个 AI Agent 管理、模型管理与开发协作平台。选择 Agent、连接模型供应商，在同一个本地工作空间中处理会话、文件、Git、终端和远程项目。

各个 Agent 保留自己的执行方式和支持的配置，OrbitCell 提供共享模型连接、项目组织、用量信息和开发工具。工作空间在本机运行，无需外部数据库或前端构建；Agent 和模型供应商使用各自的认证信息。

## 最近更新

- **紧凑的 Agent 管理**：设置按钮对齐，显示品牌图标、检测到的版本、运行环境和当前模型。本机发现过程自动检测版本，也可以重新检测指定环境。
- **独立的排序设置**：取消卡片拖动，改为在“调整顺序”窗口中上移、下移或输入位置，确认后保存；支持取消、恢复默认顺序，也能把后面页的模型和项目移到最前面。
- **以供应商为入口管理模型**：只需填写一次 API，然后批量勾选模型；以后在该供应商页面继续添加、移除或刷新型号。兼容 Agent 默认共享连接，可配置排除项、协议和专用 API 地址，也可上传供应商图标。
- **额度与余额**：供应商卡片、账户详情和对话入口共用额度信息。5 小时、每周、每月用量可以同时显示，各自保留比例、进度条与重置时间；余额和积分单独显示。还可配置自定义 JSON 额度接口。
- **原生模式与推理滑块**：权限模式以所选 Agent 实际支持的能力为准，推理滑块使用模型或 Agent 提供的档位；默认值按 Agent 和运行环境分别保存。
- **会话导入与页面偏好**：预览导出的会话，选择单条或批量导入到 Agent 历史记录；可为每个 Agent 单独设置阅读与交互偏好。

<p align="center">
  <a href="docs/assets/orbitcell-quota-cards.png"><img src="docs/assets/orbitcell-quota-cards.png" alt="额度示例：供应商卡片同时显示 5 小时、每周、每月额度与独立进度条" width="92%"></a>
</p>

截图使用隔离的演示数据。真实额度取决于供应商接口和当前密钥权限；未返回的数据会显示为未知或未提供，不会当作零余额或满额。Magpie 等聚合网关下的不同上游账户也不会合并成一个余额。支持的来源和自定义查询方式见[供应商额度](docs/provider-quotas.md)。

<details>
<summary>查看额度详情与对话入口截图</summary>

<p><a href="docs/assets/orbitcell-quota-detail.png"><img src="docs/assets/orbitcell-quota-detail.png" alt="账户额度详情：独立显示 5 小时、每周和每月周期" width="92%"></a></p>
<p><a href="docs/assets/orbitcell-quota-chat.png"><img src="docs/assets/orbitcell-quota-chat.png" alt="对话顶部显示供应商返回的各周期额度" width="92%"></a></p>

</details>

## 快速开始

需要 **[Node.js](https://nodejs.org/) ≥ 22.19.0**。可以安装一个受支持的 Agent CLI，也可以给内置 Agent 配置 Anthropic / OpenAI 兼容 API。

```bash
git clone https://github.com/1181110317/orbitcell-studio.git
cd orbitcell-studio
npm install
npm start
```

打开 **http://127.0.0.1:7261**。服务默认只监听本机回环地址。

Windows 可双击 **`start-server.cmd`**，启动器会检查运行环境、等待服务就绪并写入日志。局域网、手机访问、反向代理、服务部署与备份方式见[部署指南](docs/deployment.md)。

## 开始第一个任务

1. **连接供应商**：打开“模型 → 供应商 → 添加供应商”，填写 API 地址和密钥，再勾选要使用的模型。以后从该供应商页面继续添加其他模型，无需重新填写连接信息。目录接口不可用时，可以手动输入模型 ID。
2. **配置 Agent**：打开“Agent”，选择执行器和运行环境，设置其支持的供应商、模型、推理与权限默认值。使用原生连接的 Agent 沿用自己的模型目录和认证。本机版本自动显示，发现或版本检测不代表 API 凭据和 ACP 登录已验证。
3. **选择任务环境**：点击“新建任务”或“开始对话”，选择 Agent、运行环境和工作目录，然后发送消息。修改默认值后，已有会话保留自己的设置。
4. **导入历史记录**：进入“Agent 设置 → 会话导入”，扫描或预览支持的导出文件，再选择导入部分会话或全部剩余记录。导入不会修改源文件；能否原生续接取决于格式和来源。

## 调整工作空间的显示顺序

在 Agent、供应商、模型、项目或工具列表上方点击“调整顺序”；新建任务窗口也提供这个入口。

1. 搜索要调整的条目，使用上移、下移按钮，或直接填写位置。
2. 检查调整结果。“取消”保留原有顺序；“恢复默认顺序”只重置当前草稿。
3. 点击“保存顺序”后生效。工具分类以及进行中、归档项目的分组保持独立。

| 偏好 | 保存位置 |
| --- | --- |
| Agent 顺序 | 工作台配置，在 Agent 管理、新建任务和侧栏等入口共用 |
| 供应商、模型、项目、工具与待接入卡片顺序 | 当前浏览器 |
| 每个 Agent 的页面偏好 | 当前浏览器，按 Agent 单独保存 |

排序只改变展示位置，不会选择 Agent、启用执行器、修改模型与权限，也不会启动任务。

<details>
<summary>查看排序设置截图</summary>

<p><a href="docs/assets/orbitcell-order-settings.png"><img src="docs/assets/orbitcell-order-settings.png" alt="独立的调整顺序窗口：搜索、上下移动、填写位置、取消与保存" width="92%"></a></p>

截图使用演示供应商。卡片保留原有排版，不再显示拖动把手。

</details>

## 主要功能

- **统一 Agent 入口**：Claude Code、Codex、ZCode、DeepSeek Harness、Gemini CLI、OpenCode、自定义 CLI / ACP、内置 Agent 和普通聊天使用同一套项目与会话界面。
- **按环境配置默认值**：同一个 Agent 在本机、WSL、SSH 上分别保存模型、推理、权限和目录。新会话使用默认值，历史会话保留自己的设置。
- **自动发现与诊断**：本机自动读取可执行程序版本；选择已配置的远程环境时检测该目标，不会为了读取整个目录就连接所有 SSH 主机。需要时可手动刷新检测结果。
- **保留原生能力**：Claude Code 使用 stream-json，Codex 和 ZCode 使用 app-server，DeepSeek Harness 使用 headless JSON。权限、提问、模型选择和用量事件通过相应适配器处理；模式以执行器实际支持的能力为准。
- **完整开发工作区**：浏览、编辑和预览文件，查看差异与 Git 变更，创建提交和 PR，运行可恢复终端，查看 CPU、GPU、内存和网络状态。
- **远程与 WSL**：管理 SSH 主机，在目标环境执行文件与终端操作，保持本机、WSL 与远程项目的使用流程一致。
- **技能与工具**：集中管理技能、MCP 服务器与助手，按项目和 Agent 选择需要的能力。
- **本地数据**：JSON 为主要存储，SQLite 是可重建的索引；专用凭据存储加密保存。可选 WebUI 账户提供 CSRF 防护和登录频率限制。

## 文档

| 文档 | 内容 |
| --- | --- |
| [部署指南](docs/deployment.md) | 本机、局域网、反向代理、账户、服务与备份 |
| [配置说明](docs/configuration.md) | 环境变量、数据目录、CLI、供应商与访问控制 |
| [Agent 管理](docs/agent-management.md) | 按电脑保存配置、共享模型、诊断和新建任务 |
| [管理中心](docs/management-centers.md) | 模型、API、全局默认、技能、MCP、助手与设置 |
| [界面设计](docs/interface-design.md) | 控件、图标、响应式排版和显示顺序 |
| [供应商额度](docs/provider-quotas.md) | 余额、积分、周期用量和自定义查询接口 |
| [功能参考](docs/features.md) | 会话、文件、Git、终端、远程与自动化 |
| [产品名称](docs/branding.md) | 品牌、定位和兼容说明 |
| [架构](docs/architecture.md) | 浏览器、服务器、适配器、事件与存储 |
| [测试](docs/testing.md) | 测试命令、浏览器回归与覆盖范围 |
| [常见问题](docs/troubleshooting.md) | 端口、CLI、浏览器、代理与数据恢复 |

完整索引见 [docs/README.md](docs/README.md)。部分深入文档目前为英文。

## 项目状态

OrbitCell 持续开发中，优先支持 Windows。注册测试集包含 99 个脚本，覆盖语法、逻辑、隔离 API、协议、持久化和浏览器回归。默认测试不连接真实供应商账户、真实 SSH 主机，也不保证覆盖每个第三方 CLI 的全部版本，详见[测试范围](docs/testing.md)。

界面提供 11 套主题：`studio`、`paper`、`aionui`、`cottage`、`forest`、`ocean`、`sakura`、`ink`、`graphite`、`aurora`、`dusk`。应用将运行数据保存在本机，暂不提供内置云同步服务。

## 许可证

ISC。第三方资源和许可声明见 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。
