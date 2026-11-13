# Agent brand assets

These selected SVGs come from [Lobe Icons](https://github.com/lobehub/lobe-icons), npm package `@lobehub/icons-static-svg` version **1.101.0**, under the MIT license. The complete upstream license is included in `LICENSE`.

`logos.js` contains the same SVG geometry with document titles and sizing attributes removed for inline, accessible application rendering. The original eight Agent marks are bundled (the inline bundle is about 8.4 KB); Gemini and WorkBuddy also include upstream `-color.svg` variants, rendered as local images to keep gradient IDs isolated. No React runtime, CDN access or icon font is required. OpenAI identifies Codex; Z.ai identifies ZCode. Generic chat and the built-in Agent do not claim a vendor identity. Custom ACP names can resolve to WorkBuddy or Cursor, and users can override a mapping.

Brand marks remain the property of their respective owners. Their use identifies compatible executors and does not imply endorsement of AgentHub.

Provider cards also bundle the original MiniMax, Bailian, OpenRouter, GMI Cloud, Kimi and Moonshot marks from the same 1.101.0 package. They are matched by the actual API host. Custom endpoints use a generic connection mark.

Provider selection and management use the upstream colored DeepSeek, Claude, MiniMax, Bailian, Kimi and OpenRouter SVGs as local images, keeping each gradient namespace isolated. Xiaomi MiMo uses its upstream mark. Monochrome brand marks retain their original appearance.

The discovery catalog adds `qoder-color.svg`, `openclaw-color.svg`, `hermesagent.svg`, `pi.svg`, `grok.svg`, `qwen-color.svg` and `kiro-color.svg` from **1.102.0**, with the same MIT license. Kimi Code and MiniMax Code use their providers' existing brand marks. Pi uses the **Pi Agent** mark, not Inflection's Pi chatbot. Catalog entries are presentation metadata in `public/agent-catalog.js`; they do not claim installation or register runnable adapters. Official project links accompany each entry.

CodeBuddy and Antigravity also use the upstream **1.102.0** assets, `codebuddy-color.svg` and `antigravity-color.svg`. These remain discovery entries until an actual adapter and installation are present.

Provider icon uploads use the same browser appearance store as Agent icons. Images are normalized to a transparent 128 × 128 PNG; external resources and active SVG content are rejected. Saving a connection commits the icon draft, while cancel leaves existing appearance unchanged. Custom icons take precedence over host-based brand detection and can be reset to the automatic brand mark.
