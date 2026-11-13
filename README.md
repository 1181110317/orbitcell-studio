<div align="center">

[English](README.md) · [简体中文](README.zh-CN.md)

<img src="public/brand.svg" alt="OrbitCell" width="64">

<h1>OrbitCell Studio</h1>

<p><strong>AI Agent Development Workspace</strong><br>统一 AI 智能体开发工作空间</p>
<p>One Orbit. Infinite Possibilities.</p>
<p>Unify Agents, Models, Tools and Workflows.</p>

<p>Claude Code · Codex · ZCode · DeepSeek Harness · Gemini CLI · OpenCode · WorkBuddy · Cursor ACP · Custom</p>

<p>
  <a href="https://github.com/1181110317/orbitcell-studio"><img alt="GitHub" src="https://img.shields.io/badge/github-1181110317%2Forbitcell-studio-24292f?logo=github"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/node-%E2%89%A522.19-339933?logo=node.js&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-ISC-blue">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4?logo=windows">
</p>

</div>

<p align="center">
  <a href="docs/assets/orbitcell-agents.png"><img src="docs/assets/orbitcell-agents.png" alt="OrbitCell Studio: compact Agent management with model, version and environment controls" width="92%"></a>
</p>

<p align="center">
  <sub>Agents, models and development workflows in one workspace. Preview uses an isolated dataset.</sub>
</p>

OrbitCell Studio is an AI Agent management, model management and development collaboration platform. Choose an Agent, connect your model providers, and work with conversations, files, Git, terminals and remote environments in one local workspace.

Each Agent keeps its own runtime and supported controls. OrbitCell adds shared model connections, project organization, usage information and development tools. The workspace runs locally without an external database or a front-end build step; Agents and model providers use their own credentials.

## What's new

- **Compact Agent workspace** — aligned settings, brand icons, detected versions, models and environments. Local discovery checks versions automatically; an explicit environment check is available to refresh the result.
- **Order settings** — card dragging has been replaced by a separate Adjust order dialog. Move entries up/down or enter a position, then save. Cancel and Restore default are available, including for models and projects beyond the first page.
- **Provider-first model management** — configure a provider once, select models in bulk, then return to that provider to add more. Compatible Agents share the connection by default; exclusions and protocol/API-address exceptions are configurable. Provider icons can be customized with an upload.
- **Balances and allowances** — provider cards, account details and the conversation header share one quota view. Five-hour, weekly and monthly allowances appear together with separate progress bars; balances and credits keep their own units. Custom JSON mappings support other read-only quota APIs. Missing readings stay unknown.
- **Native modes and reasoning slider** — permission modes follow the selected Agent's capabilities, and the slider uses the model or Agent's published effort levels. Save defaults separately for each Agent and environment.
- **History and page preferences** — preview exported conversations, select individual records or import batches into an Agent's history. Reading and interaction preferences can be customized per Agent.

<p align="center">
  <a href="docs/assets/orbitcell-quota-cards.png"><img src="docs/assets/orbitcell-quota-cards.png" alt="Provider cards with aligned actions, balances, credits and simultaneous five-hour, weekly and monthly allowance windows" width="92%"></a>
</p>

<p align="center">
  <sub>Provider cards with three independent allowance windows. All screenshots use isolated demo data.</sub>
</p>

Quota availability depends on the provider's API and the current credentials. An unavailable reading stays unknown. Upstream accounts behind an aggregator such as Magpie are not combined into one balance. See [provider quotas](docs/provider-quotas.md) for supported sources and custom mappings.

<details>
<summary>View account details and conversation quota previews</summary>

<p><a href="docs/assets/orbitcell-quota-detail.png"><img src="docs/assets/orbitcell-quota-detail.png" alt="Account quota details with five-hour, weekly and monthly periods" width="92%"></a></p>
<p><a href="docs/assets/orbitcell-quota-chat.png"><img src="docs/assets/orbitcell-quota-chat.png" alt="Conversation header showing all returned quota periods" width="92%"></a></p>

</details>

## Contents

| Start here | What's inside |
| --- | --- |
| ⚡ [Quick start](#quick-start) | Install and launch a local instance |
| 🧭 [First task](#start-your-first-task) | Add a provider, choose an Agent and start a conversation |
| ↕ [Display order](#arrange-your-workspace) | Set positions without dragging cards |
| 🚀 [Deployment guide](docs/deployment.md) | Local install, Windows launcher, LAN/phone access, reverse proxy, accounts, backups, upgrades and service examples |
| ✨ [Feature reference](docs/features.md) | Every capability: agents, chat timeline, models, usage, workspace, Git/PR, terminals, remote, automation and security |
| ⚙️ [Configuration](docs/configuration.md) | Environment variables, data directory, agent CLI setup, provider setup and access control |
| 🧭 [Agent management](docs/agent-management.md) | Per-computer Agent defaults, shared models, diagnostics, task creation and the Studio theme |
| 🧩 [Management centers](docs/management-centers.md) | Model catalog, shared API connections, global presets, skills, MCP servers, assistants and settings |
| 🎨 [Interface design](docs/interface-design.md) | Shared typography, controls, icons and responsive surfaces across every built-in workspace |
| 💳 [Provider quotas](docs/provider-quotas.md) | Balances, credits, timed allowances and custom read-only quota APIs |
| 🪐 [Product identity](docs/branding.md) | OrbitCell Studio names, positioning and installation compatibility |
| 🏗 [Architecture](docs/architecture.md) | Browser/server split, agent adapters, event model, storage layers and directory layout |
| 🧪 [Testing](docs/testing.md) | Test suite, focused commands, browser checks and coverage boundaries |
| 🩺 [Troubleshooting](docs/troubleshooting.md) | Port conflicts, missing CLIs, browser/docked-page issues, proxy problems, data recovery and common errors |

A standalone documentation index is also available at [docs/README.md](docs/README.md).

## Quick start

**Requires [Node.js](https://nodejs.org/) ≥ 22.19.0** and at least one agent CLI — or use the built-in agent with an Anthropic/OpenAI-compatible provider.

```bash
git clone https://github.com/1181110317/orbitcell-studio.git
cd orbitcell-studio
npm install
npm start
```

Open **http://127.0.0.1:7261**. The server listens on loopback by default.

On Windows, double-click **`start-server.cmd`** for a launcher with runtime checks, readiness output and a log file. For LAN / phone access, reverse-proxy setups, service managers and backups, see the [deployment guide](docs/deployment.md).

## Start your first task

1. **Connect a provider.** Open **Models → Providers → Add provider**, enter the API address and key, then select the models to use. Add more models later from that provider's own page. If its catalog endpoint is unavailable, enter model IDs manually.
2. **Configure an Agent.** Open **Agent**, choose an executor and environment, then set supported provider, model, reasoning and permission defaults. Native-only integrations use their own model catalog and authentication. Detected versions appear automatically; discovery does not verify provider credentials or ACP login.
3. **Choose the task context.** Click **New task** or **Start conversation**, select an Agent, environment and working directory, then send your message. Existing conversations retain their own settings when defaults change.
4. **Bring in your history.** Open **Agent settings → Session import** to scan or preview supported export files, then import selected conversations or all remaining records. Imports add history without modifying the source files; native resumability depends on the format and source.

## Arrange your workspace

Use **Adjust order** above an Agent, provider, model, project or tool list. The new-task chooser also provides this action.

1. Find an entry, use the up/down buttons or type its position.
2. Review the draft. **Cancel** keeps the previous order; **Restore default order** resets the draft.
3. Click **Save order** to apply it. Tool and project categories remain grouped.

| Preference | Saved where |
| --- | --- |
| Agent order | Workspace configuration, shared by Agent management, the new-task chooser and sidebar |
| Provider, model, project, tool and pending-integration card order | Current browser |
| Per-Agent page preferences | Current browser, separately for each Agent |

Reordering changes display positions only. It does not select an Agent, enable an integration, change a model or permission, or start a task.

<details>
<summary>Preview the order settings dialog</summary>

<p><a href="docs/assets/orbitcell-order-settings.png"><img src="docs/assets/orbitcell-order-settings.png" alt="Separate order settings dialog with search, up/down buttons, position fields, Cancel and Save order" width="92%"></a></p>

The preview uses demo providers. Cards keep their original layout without drag handles.

</details>

## Feature highlights

- **Every agent, one window** — Claude Code, Codex, ZCode, DeepSeek Harness, Gemini CLI, OpenCode, custom CLI/ACP agents, a built-in agent and a ChatGPT-style chat mode share one UI and one project list.
- **Agent management** — pinning, explicit ordering, status filters and enable/disable controls; shared model defaults, recent sessions and supported per-Agent tool settings. Local, WSL and SSH defaults remain separate. Local versions are discovered automatically; selecting a configured remote environment checks that target without scanning every SSH host.
- **Native protocol bridges** — Claude speaks `--input-format stream-json`, Codex and ZCode use their `app-server` protocols, and DeepSeek Harness uses `dsh headless --json`. Supported permissions, questions, model choice and usage events flow through each adapter.
- **Shared model management** — provider connections, bulk model selection, capability metadata, per-Agent usage exceptions and reusable override profiles; connect Magpie or an Anthropic/OpenAI-compatible API.
- **Development tools** — browse and edit files, preview diffs, inspect Git changes, create commits and PRs, run durable terminals and monitor CPU/GPU/network usage without leaving the conversation.
- **Remote and WSL first-class** — manage SSH hosts, stream remote sessions, preview images over SSH, run target-side file operations and share the same workflow across local, WSL and remote projects.
- **Local-first and inspectable** — JSON is authoritative, SQLite is a rebuildable index, dedicated secret stores are encrypted at rest, and optional WebUI accounts add CSRF protection and login rate limits.

## Project status

OrbitCell is actively developed and Windows-first. The registered test suite contains 99 scripts covering syntax, logic, isolated API, protocols, durability and browser regressions. External provider accounts, real SSH hosts and every third-party CLI are not exercised by the default suite; use the [testing guide](docs/testing.md) for the exact scope. The application stores runtime data locally; there is no built-in cloud sync or multi-user cloud service.

Appearance includes 11 themes: `studio`, `paper`, `aionui`, `cottage`, `forest`, `ocean`, `sakura`, `ink`, `graphite`, `aurora`, `dusk`. Studio is the clean demo style; existing theme preferences remain available.

## License

ISC. See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for bundled third-party notices.
