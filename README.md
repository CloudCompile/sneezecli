# sneezecli

An interactive coding-agent harness for your terminal. `sneezecli` uses your
own API keys (BYOK) and routes OpenAI-compatible requests across a curated set
of free providers. It can read, edit, search, and run commands in a repository
using a single agent loop.

## Installation

### From npm

Install the command globally once:

```bash
npm install --global sneezecli
```

After that, start the application from any directory:

```bash
sneezecli
```

The package declares the `sneezecli` executable and ships its compiled CLI.
Node.js 20 or newer is required. Git and source installs build automatically.

### From GitHub

To use the current repository version before it is published to npm:

```bash
npm install --global https://github.com/sneezejayhauser/sneezecli.git
sneezecli
```

### From a checkout

```bash
git clone https://github.com/sneezejayhauser/sneezecli.git
cd sneezecli
npm install
npm link
sneezecli
```

`npm link` puts the local build on your `PATH`; `npm run build` can be used
after source changes.

## Quick start

1. Configure at least one provider key. For example:

   ```bash
   export OPENROUTER_API_KEY=...
   export INCEPTIONLABS_API_KEY=...
   export TOKENREPLY_API_KEY=...
   export REQUESTY_API_KEY=...
   export LOGFARE_API_KEY=...
   export POLLINATIONS_API_KEY=...
   ```

2. Add the complete compatible text-model catalog:

   ```bash
   sneezecli add --auto
   ```

   Or add individual models with `sneezecli add <provider> <model> [priority]`.
   Browse the built-in catalog with `sneezecli models`.

3. Start the interactive agent:

   ```bash
   sneezecli
   ```

`pollinations-noauth` is available as a keyless last-resort provider. It does
not support tools or streaming, so configuring a keyed provider is recommended
for coding tasks.

### Public model metadata

Routing can refresh its model metadata without additional API keys:

```bash
sneezecli sync-models
```

The sync combines OpenRouter's official `/api/v1/models` catalog with the
public Arena text/code leaderboards, the Hugging Face Open LLM Leaderboard
dataset server, and the latest `Jwrede/llm-bench-data` benchmark snapshot.
OpenRouter supplies the broad model facts—context size, modalities, pricing,
and tool support—and those facts can be matched to equivalent models exposed
through other providers.

### Interactive provider setup

Use the provider flow instead of adding models one by one:

```bash
sneezecli --catalog
```

Choose a provider, enter its API key when prompted, and sneezecli will add all
compatible text models for that provider to the local pool. Keyless providers
such as `pollinations-noauth` skip the key prompt. The provider key and model
pool are saved in `~/.config/sneezecli/config.json`, so they are available the
next time you run `sneezecli`.

Inside the TUI, `/catalog` or `/provider` opens the same flow. There is no
visible model list in onboarding: selecting a provider configures it and adds
all compatible text models automatically. `/model` only reports the configured
pool; task-aware routing chooses the actual model.

## Providers and routing

The provider registry is deliberately closed and maintained by the project.
Current providers are:

| Provider | Notes |
| --- | --- |
| `openrouter` | Quality models; account-wide daily and RPM limits |
| `inceptionlabs` | Shared token budget and high RPM limit |
| `tokenreply` | Account-wide 3 RPM limit |
| `requesty` | Account-wide daily limit |
| `logfare` | Account-wide RPM limit |
| `pollinations` | Keyed, per-model limits |
| `pollinations-noauth` | No key; tools and streaming unavailable |

Routing is model-first rather than provider-tier-first. Each request is ranked
using the model's capability, coding, arena-preference, speed, latency, and
semantic tags. The router then checks that individual model's availability and
its applicable limit bucket before trying it. Rate-limited or exhausted models
fall through to the next ranked model. A per-ranked-group cursor spreads load
across equivalent models, while rate state persists across processes.

The repository can contain a reviewable snapshot at
`data/model-metadata.json`. The built-in catalog remains the safe fallback when
benchmark data is unavailable. Metadata is intentionally optional: routing
continues using catalog tags and neutral default scores.

### Model metadata sources

The metadata sync layer accepts normalized JSON from the two initial sources:

- Artificial Analysis, configured with `SNEEZE_ARTIFICIAL_ANALYSIS_URL` and
   `ARTIFICIAL_ANALYSIS_API_KEY`.
- LMArena/Chatbot Arena, configured with `SNEEZE_LMARENA_URL`.

Run a sync after setting those variables:

```bash
SNEEZE_ARTIFICIAL_ANALYSIS_URL=https://... \
SNEEZE_LMARENA_URL=https://... \
sneezecli sync-models
```

The URLs are configurable because both services may expose different preview,
dataset, or proxy endpoints over time. The command merges fetched rows with
the built-in catalog and writes the snapshot to `data/model-metadata.json`
(override the path with `SNEEZE_METADATA`). Do not commit API keys or private
raw responses. A future adapter can add `llm-bench-data` performance rows
without changing the router interface.

Useful commands:

```bash
sneezecli setup                 # show key and pool setup help
sneezecli providers             # list provider limits
sneezecli models [provider]     # browse the model catalog
sneezecli add --auto            # add all catalog text models
sneezecli sync-models           # refresh optional benchmark metadata
sneezecli pool                  # show the configured pool
sneezecli status                # show rate and budget state
sneezecli cost                  # show this process's usage
```

## Interactive TUI

Running `sneezecli` without arguments opens the streaming TUI. You can enter
another request while a turn is running; it is queued for the next turn. Press
Esc to abort a turn and terminate an in-flight shell command.

Available slash commands:

```text
/help                 Show commands
/new                  Start a new session
/resume [id]          Resume a saved session
/sessions             List saved sessions
/rename <name>        Rename the current session
/delete-session       Delete a saved session
/model                Show configured model count; routing is automatic
/catalog              Choose a provider and add all compatible models
/pool                 Show the configured model pool
/providers            List providers
/usage                Show session usage
/context              Show context-window usage
/compact              Summarize older history
/subtask <task>       Start a background subagent
/tasks                Show background subagents
/cwd <directory>      Change the working directory
/yolo                 Toggle automatic approval of dangerous tools
/clear-screen         Clear the terminal
/export [file]        Export the transcript as Markdown
/exit                 Save and exit
```

Dangerous tools such as `bash`, file writes, patches, and deletion ask for
approval unless `/yolo` is enabled. `/compact` uses the selected LLM to
summarize older history, keeps the last four messages verbatim, and leaves the
session unchanged if summarization fails.

## One-shot mode

```bash
sneezecli run "refactor src/ to use async/await"
sneezecli -p "find and explain the failing tests"
sneezecli run "apply the migration" --yolo
sneezecli run "continue the work" --resume <session-id>
```

## Configuration and sessions

Configuration and sessions are stored by default under:

```text
~/.config/sneezecli/config.json
~/.config/sneezecli/sessions/
```

Override these locations when testing or isolating profiles:

```bash
SNEEZE_CONFIG_DIR=./.sneezecli sneezecli
SNEEZE_CONFIG=./test-config.json sneezecli status
```

The configuration includes the model pool, maximum output tokens, context
limits, system prompt, iteration limit, and the default approval mode.

## Development and mock mode

Build and run the local CLI:

```bash
npm install
npm run build
node dist/index.js --help
```

The hidden mock provider can exercise the real agent and tools without API
keys:

```bash
SNEEZE_CONFIG=./test-pool.json \
SNEEZE_MOCK=1 \
SNEEZE_MOCK_SCRIPT=./mock-script.json \
sneezecli run "audit the loop"
```

The mock script is a JSON list of tool calls followed by a final response. It
executes the real tools against the current repository.

## License

MIT
