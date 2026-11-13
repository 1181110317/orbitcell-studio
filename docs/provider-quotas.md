# Provider balances and allowances

Open **Models → Providers** to see a compact balance or allowance beneath each
provider. Open the provider for the full **Account quota** panel. A conversation
using that provider shows the same compact reading in its header; click it to
see balances, credits, windows and reset times.

Readings come from billing or usage APIs, never from a test completion. They are
cached for five minutes. **Refresh** requests a new reading; overlapping requests
share a query. Editing a provider or its quota settings invalidates the server
cache. Failed and missing readings do not become a zero or a full allowance.

| Automatic source | Display |
| --- | --- |
| DeepSeek | Available balance and currency |
| OpenRouter | Available credits/balance, usage or an unlimited key |
| MiniMax Token Plan | API-reported 5-hour and weekly allowances |
| Moonshot | Available balance in the account currency |
| Zhipu / Z.ai Coding Plan | API-reported 5-hour, weekly and MCP monthly windows |
| Kimi Code | Counted or percentage-based subscription windows |
| OpenCode Go | Rolling, weekly and monthly allowances |
| Codex OAuth | API-reported windows and available credits, when returned |
| New API / One API token endpoint | Raw quota units; no assumed conversion to money |
| Other OpenAI-compatible services | Legacy billing endpoints, when implemented |

An API key is not always permitted to read an account's billing information.
Some providers need a separate management token; others expose no quota API.
A local gateway such as Magpie routes to upstream accounts and does not have one
combined balance. Inspect those accounts in the upstream provider or Magpie.
Do not add allowances from different accounts or currencies together.

## Custom quota API

Open **Account quota → Quota settings**. Choose automatic detection, the New API
token endpoint, or a custom JSON endpoint. Queries use GET with Bearer,
`x-api-key`, or no authentication. An optional independent query token is stored
on the server and masked in responses; leaving it blank preserves a saved token.
Return to automatic mode to remove the custom configuration.

For custom JSON, add up to six named display items:

- **Balance** or **credits/quota**: a numeric field and its unit.
- **Periodic allowance**: remaining/used quantity or percentage. An optional
  total field allows quantity-to-percentage conversion; an optional reset field
  accepts ISO dates or epoch timestamps in seconds/milliseconds.
- **Period**: 5 hours, daily, weekly or monthly. This labels the allowance; the
  actual reset date comes from the API, not a guessed calendar boundary.

For example, `data.balance` selects the number in
`{"data":{"balance":38.5}}`. Array entries use numeric path components, such as
`data.windows.0.used_percent`. Percentages are literal 0–100 values: `1` means
1%, and an absent field stays unknown. Custom queries do not execute scripts or
return the complete remote response to the browser.

The distinction between money, timed allowances and credits follows the same
principle as [Magpie's provider balance handling](https://github.com/yetone/magpie/blob/main/internal/provider/balance.go)
and [subscription windows](https://github.com/yetone/magpie/blob/main/internal/provider/subscription_usage.go).
Supported upstream APIs and account permissions can change independently of
OrbitCell Studio.
