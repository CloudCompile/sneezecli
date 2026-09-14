# sneezecli

BYOK agent harness routed over **free** LLM providers. No subscriptions.

## How it works

One agent loop, one tool set, one router. The router walks a **closed, curated
list of free providers** — best-capable tier first, falling to lower tiers when
a provider is rate-limited or out of budget.

```
Tier 1  OpenRouter best free model     (50 rpd — spend on hard tasks)
Tier 2  InceptionLabs                  (100M one-time token budget)
Tier 3  Pollinations round-robin       (unlimited, rpm-throttled per model)
Tier 4  TokenReply / no-auth fallback  (always-on last resort)
```

**No model names are assumed.** You add every model id yourself.

## Providers (closed list — more coming)

| id | notes |
|---|---|
| `openrouter` | best quality, 50 rpd hard cap |
| `pollinations` | unlimited requests, rpm-throttled per model |
| `poolside` | free tier, dynamic undocumented limits |
| `inceptionlabs` | 1000 rpm, 100M one-time token budget |
| `tokenrouter` | free models, no known limit, may vanish |
| `tokenreply` | many free models, 3 rpm, unstable |

Providers are **not user-extensible** — the list is maintained in
`src/providers.ts`. Model ids within each provider are user-supplied.

## Setup

```bash
npm install && npm run build
npm link   # optional, puts `sneezecli` on PATH
```

Export keys:

```bash
export OPENROUTER_API_KEY=...
export POLLINATIONS_API_KEY=...
export INCEPTIONLABS_API_KEY=...
```

Add models (you pick the ids and tiers):

```bash
sneezecli add openrouter <model-id> 1
sneezecli add inceptionlabs <model-id> 2
sneezecli add pollinations <model-id> 3 --rpm 8
sneezecli add tokenreply <model-id> 4 --rpm 3
```

## Use

### Interactive TUI (main mode)

```bash
sneezecli
```

Full-screen TUI with streaming responses, live tool-call display, session
management, and input queuing (type while the agent works — it drains after
the turn). Esc aborts a running turn and kills in-flight bash commands.

Slash commands:

```
/help       /new         /resume [id]   /sessions
/rename <n> /delete-session             /model
/catalog    /pool        /providers     /usage
/context    /compact     /subtask <t>   /tasks
/cwd <dir>  /yolo        /export [f]    /exit
```

- `/model` — picker over the full catalog; picked model becomes primary (tier 1)
- `/compact` — summarize older messages to free context
- `/subtask <task>` — spawn a background subagent with its own conversation;
	result posts back when done. The agent itself can spawn subtasks via the
	`subtask` tool.
- `/tasks` — list background subagents and their status
- `/context` — context window usage bar
- `/export [file]` — save transcript as markdown

Dangerous tools (`bash`, `write_file`, `edit_file`, `patch_file`, `delete_file`,
`bash_bg`) prompt for approval in safe mode. `/yolo` or answering `a`ll
disables prompting for the session.

### One-shot

```bash
sneezecli pool      # list configured models
sneezecli status    # rate-limit / budget state per model
sneezecli run "refactor src/ to use async/await"
sneezecli run "task" --yolo          # auto-approve dangerous tools
sneezecli run "task" --resume <id>   # continue a saved session
sneezecli cost                       # session token/request usage
```

## Tools

| tool | dangerous | notes |
|---|---|---|
| `read_file` | | line ranges, numbered output |
| `write_file` | ✓ | creates dirs, overwrites |
| `edit_file` | ✓ | exact unique substring replace |
| `patch_file` | ✓ | multiple edits in one call |
| `list_dir` | | |
| `glob` | | `src/**/*.ts` style |
| `grep` | | regex, file:line output |
| `bash` | ✓ | 60s timeout |
| `bash_bg` | ✓ | detached dev servers / watchers |
| `delete_file` | ✓ | |
| `file_info` | | size / lines / ext |

## Router features

- **Capability-first**: lowest tier number available wins.
- **Round-robin within tier**: consecutive calls rotate across same-tier models,
	spreading load (critical for OpenRouter's 50 RPD account cap and for
	multiplying Pollinations' per-model RPM). Cursor persists across processes.
- **Budget tracking**: rpm, rpd, and one-time token budgets tracked per model.
	Rate state persists across processes, so one-shot `run` invocations share
	the same budgets as the REPL.
- **Provider-scoped limits**: limits marked `scope: "provider"` (OpenRouter 50
	rpd, TokenReply 3 rpm, InceptionLabs 100M tokens) are metered across ALL
	models on that provider, not per model.
- **429 cooldown**: a rate-limited model sits out the rest of the minute.
- **Retry**: one automatic retry on 429/5xx/network errors before falling through.
- **Context trimming**: keeps system prompt + recent messages when over budget.
- **Streaming**: SSE streaming with live token output and tool-call accumulation.

## Config

`~/.config/sneezecli/config.json`:

```json
{
	"models": [{"provider": "pollinations", "model": "<id>", "tier": 3, "rpm": 8}],
	"maxTokens": 4096,
	"maxContextMessages": 40,
	"yolo": false,
	"systemPrompt": "..."
}
```

Sessions persist in `~/.config/sneezecli/sessions/`.

## Dev dogfooding

The harness can run on itself without API keys via a hidden mock provider:

```bash
SNEEZE_CONFIG=./test-pool.json SNEEZE_MOCK=1 \
SNEEZE_MOCK_SCRIPT=./mock-script.json sneezecli run "audit the loop"
```

`SNEEZE_CONFIG` overrides the config path. The mock script is a JSON list of
`{tool, args}` calls followed by a `final` string — the agent executes the real
tools against your repo, so you can watch the full loop work without keys.