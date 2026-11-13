# Agent management

Open **Agent** in the sidebar to manage executors. Open **Models** for shared model connections, and **Environments** to group the same Agent configurations by computer.

The management page uses the prototype's catalog and workspace layout. Each Agent has one catalog entry; local, WSL and SSH installations appear inside its inspector. The overview presents Agent cards with brand icons, effective models, environments, status, **Start conversation** and **Settings** actions. Environment readiness describes CLI detection, not model-account authentication.

Use **Organize** to pin, reorder, hide or restore entries. These preferences are saved on the backend. Hidden Agents keep their sessions and remain enabled unless explicitly disabled. The overview can filter ready, attention, disabled and hidden entries; the search also matches configured models, connections and environments.

## Configure an Agent

1. Open an Agent card's **Settings**. Expand the compact environment selector to choose local, WSL or SSH. Use **Add Agent** for executors that are not in the catalog.
2. **Conversation settings** groups provider/model and reasoning/permission defaults in aligned fields. **Manage models** opens the provider's model selector; native-only Agents read their native directory. Its preview identifies the inherited source. Unsupported controls show the executor's native management instead of accepting ineffective values.
3. Open **Runtime and advanced** to change that computer's command or upgrade command. Local executable paths and upgrade commands are separate from remote ones. Saving and checking do not execute upgrades.
4. Save, or cancel to restore the saved values. Unsaved drafts remain available when switching between Agent configurations during the same page visit.

Defaults are stored separately for each Agent and environment. An environment override takes precedence over the existing global Agent defaults. Changing connections does not carry a model or reasoning setting from the previous connection.

Existing conversations keep their model and permission choices. **Start conversation** on an Agent card or inspector opens the main composer using that Agent and environment's saved defaults. It creates no empty history record or inference request; choose the project and click **Send** when ready. Unsaved settings must first be saved or cancelled. The workspace sidebar uses a flat Agent selector with icons and selected checkmarks; selecting an Agent also opens the composer. Optional multi-select conversation filtering remains separate.

The inspector's **Recent sessions** opens actual conversations for that Agent and computer. **View all** returns to the workspace with the Agent filter applied.

The regular empty composer also shows the selected environment's defaults. Switching computers clears an incompatible project directory and updates the default connection, model, effort, and permissions.

## Share model connections

Connections are managed once in **Models → Providers**. Compatible Agents can use a shared connection without individual assignment. The catalog's **Usage settings** lists every Agent, allows explicit exclusions and per-Agent protocol/API-address exceptions, and can directly save a global or local Agent default. Environment-specific defaults remain in the Agent inspector.

DSH uses a temporary, session-scoped Profile overlay for shared API connections; keys are supplied through the child environment rather than copied into that overlay. It also exposes its own configured model catalog when no shared connection is selected. ACP uses native model catalogs, including modern model configuration options, and changes the model within the same native session. WorkBuddy's installed catalog is readable without an authenticated ACP connection; catalog discovery does not certify its login or runtime connection. Executors without an OrbitCell permission bridge display native permissions.

The global default lives in **Models → Providers**. Agent override presets and explicit environment configurations take precedence. **Restore global default** clears this Agent's common model override and the selected environment's model override, preserving commands, permissions, other environments and existing sessions. ACP, Gemini and OpenCode retain their own connection configuration and do not display an inherited API connection.

## Check an environment

Local discovery automatically reads executable versions and capabilities. A successful version check is immediately reflected in the cards; it does not require another manual check. Version text and discovery notes are separate: unknown versions stay explicitly unknown. **Check environment** remains available to refresh a bounded check. Selecting a configured remote environment checks that target automatically, while reading the whole catalog does not connect to SSH hosts.

The environment overview shows unconfigured targets by default. Its row opens configuration; the separate check button tests that exact Agent and computer, with an independent pending state. A completed local version check counts as CLI verification. ACP discovery is labeled **Adapter discovered**, which does not certify protocol initialization or authentication. An invalid explicit executable path does not silently fall back to another installation.

CLI detection does not verify model API credentials, quota, billing, or model output. ACP adapters verify the protocol when a conversation starts; a launcher version is not presented as proof of an ACP connection. Built-in and ACP Agents are local integrations.

## Native modes, page preferences and session import

The composer and Agent inspector use the same adapter-specific mode catalog. Codex has read-only, workspace-write and full-access sandboxes; DSH exposes its native Profile presets; ZCode uses build/edit/plan/yolo. Claude controls follow the installed CLI capabilities. ACP/Gemini/OpenCode display only mode IDs and labels returned by their protocol, separately from OrbitCell's approval policy. Selecting a native mode never automatically broadens that approval policy. Reference: [OpenCode permissions](https://opencode.ai/docs/permissions/), [CodeBuddy permissions](https://www.codebuddy.ai/docs/cli/permissions), [Antigravity Agent settings](https://antigravity.google/docs/agent-settings).

**Page preferences** stores twelve reading and interaction choices for this Agent in the current browser: width, expansion depth while running/after completion/in history, output following, tool timing/counts, reply model, plan progress, diagnostics, reply actions and send shortcut. Resetting removes that Agent's overrides. Global typography and other Agents remain unchanged.

**Session import** supports read-only source scans, JSON/JSONL export-file preview, search, select, import selected and import all remaining. Claude/CodeBuddy JSONL, Codex JSONL, Gemini JSON, Pi JSONL, OpenCode exported JSON and generic message JSON are supported. Pi imports the active branch. Tool records and output are preserved in supported formats. Formats without a known native location require a source directory or exported files; binary/private databases are not guessed or converted.

Imports create OrbitCell history without modifying source files. Only Claude files inside its configured native source root retain the native resume ID; other exports enter as history. Preview IDs are scoped to the destination Agent and expire after thirty minutes. Changed source files require a new scan. Duplicate detection covers concurrent batches and imported records later archived by OrbitCell. A failed file does not prevent other selected records from importing. The import panel is unavailable to read-only identities and currently reads files on the OrbitCell computer, not an SSH host.

CodeBuddy and Antigravity are included with local brand marks in the discovery catalog. Unconnected entries remain explicitly **Pending integration**, are separate from executable Agents and do not appear in the new-task runtime picker.

Read-only users can browse configurations but cannot save, add Agents, create tasks, or execute diagnostics.

## Tools and availability

**Tools & permissions** contains the target-specific default permission mode and supported per-Agent controls for project permission memory, third-party MCP servers, the controlled browser and OrbitCell tools. Global tool settings remain the upper limit. MCP counts distinguish configured servers, last-tested tools and untested servers; local counts do not describe a remote host.

Turning off project permission memory prevents remembered grants from approving subsequent tools. Native CLI/ACP MCP changes take effect when a new conversation starts. A CLI's own independently configured tools remain under that CLI's control. Skill, MCP-server and assistant actions open their existing managers.

Use **Disable** in Advanced settings to stop creating new tasks with an Agent. Existing conversations and running tasks are preserved and can still be used. Re-enable it from the inspector or directory.

## Add a custom Agent

**Add Agent** opens a searchable preset directory. Choosing a preset enables its catalog entry and opens configuration; it does not install software. Choose **Custom CLI / ACP**, enter its name and executable, and put optional arguments in the separate arguments field. Creating a custom Agent appends a new identity and preserves existing Agents. Test the command before using it for a task.

## Appearance

The **Studio / 清简** theme applies the demo's light palette, restrained borders, spacing, and typography to the workspace, controls, and dialogs. Select it from **Appearance**; the choice is remembered in that browser. Existing saved theme preferences remain available.

On narrow screens, **Open Agent catalog** expands the catalog above the workspace; choosing an Agent closes it. Cards and settings rows adapt to the available width. The inspector tabs support arrow keys, Home, and End.

## Upgrading a running instance

Restart the backend after updating the server files, then refresh the browser. The catalog API is version 3. An older backend can display the page, but organization, enable/disable and tool-preference controls stay disabled with a restart notice until the new API is loaded.

For focused server tests, run `node test/agent-center.js`. See [Testing](testing.md) for the wider suite and coverage boundaries.


DSH 会话支持原生权限预设（Agent 默认、只读、工作区写入、完全访问），与其他执行器的通用权限模式分别保存。推理强度按所选模型目录公布的档位提供；没有可调档位时使用模型默认值。修改会话配置后下一轮生效；“默认设置”可将当前选择用于该 Agent 和环境的新会话。


Claude、Codex、ZCode 与内置 Agent 在输入栏提供各自有效的权限与推理选项。Codex 显示只读、工作区写入、完全访问；ZCode 显示 low/high/max。ACP、本机 Gemini/OpenCode 按初始化返回的模型与 thought_level / mode 选项设置；非标准档位可打开“原生配置”。这些配置可以在首轮前设置并保存为该 Agent 的新会话默认值。原生连接失败、CLI 未找到与模型不提供可调档位会分别提示，目录存在不等于原生执行已验证。
