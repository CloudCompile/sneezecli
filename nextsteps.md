For the **whole agent**, the next step should be moving from “provider router with tools” to a reliable, observable **agent runtime**. Prioritize these areas:

## 1. Agent correctness

Define explicit success criteria for each turn:

- Did the agent understand the task?
- Did it select appropriate tools?
- Did tools execute successfully?
- Did it verify its changes?
- Did it stop when the task was complete?
- Did it report failures accurately?

Add an internal turn result such as:

```ts
interface AgentTurnResult {
  status: "completed" | "failed" | "cancelled" | "max_iterations";
  iterations: number;
  toolCalls: number;
  filesChanged: number;
  verificationPassed?: boolean;
}
```

This makes behavior measurable instead of relying only on generated text.

## 2. Tool execution safety

This is probably the highest-risk area.

Improve:

- confirmation handling for writes and shell commands;
- command timeouts and cancellation;
- output size limits;
- protection against accidental destructive commands;
- clear distinction between read-only and mutating tools;
- structured tool errors returned to the model;
- recovery when a tool partially succeeds;
- prevention of infinite repeated tool calls.

Every tool invocation should have an ID, duration, result status, and bounded output.

## 3. Context and session management

The agent needs predictable context behavior:

- summarize older messages instead of only trimming them;
- preserve tool-call/tool-result pairs;
- detect context overflow and retry with a smaller context;
- persist session metadata separately from message content;
- support session resume and session branching;
- prevent secrets from being written into session files where possible.

The current `maxContextMessages` limit is useful, but message-count trimming alone will eventually damage task continuity.

## 4. Planning and verification

Add an optional execution structure:

1. Understand the request.
2. Inspect the repository.
3. Form a short plan.
4. Make changes.
5. Run targeted checks.
6. Review the resulting diff.
7. Summarize completed work and remaining risks.

Do not force verbose plans for every request. A lightweight internal plan is enough, with visible planning configurable.

Verification should be a first-class capability. For coding tasks, the agent should generally inspect:

```bash
git diff --check
```

and run the project’s relevant build or test command when available.

## 5. Model capability and routing

The router should distinguish:

- chat-only models;
- tool-capable models;
- models that support streaming;
- models with reliable structured tool calls;
- models suitable for long contexts;
- models suitable for coding tasks.

Track capability failures separately from transient failures. For example:

- HTTP `410`: model retired — quarantine immediately;
- HTTP `404`: invalid endpoint/model — quarantine immediately;
- timeout: temporary or overloaded — use exponential backoff;
- malformed tool call: model capability problem;
- corrupt stream: model/provider reliability problem.

The best model should not simply be the cheapest or highest-ranked model; it should be the best model for the current task.

## 6. Runtime lifecycle

Add robust cancellation and shutdown behavior:

- Ctrl+C should abort the current request and tool process;
- no orphaned child processes;
- temporary files cleaned up;
- interrupted sessions saved consistently;
- streaming output restored to a clean terminal state;
- telemetry and diagnostics flushed best-effort without delaying exit.

This matters significantly for interactive use.

## 7. Evaluation suite

Create a repeatable agent benchmark with scenarios such as:

- read a file and answer a question;
- edit a file precisely;
- fix a failing test;
- use multiple tools in sequence;
- recover from a failed command;
- handle a model timeout and fallback;
- reject malformed tool output;
- avoid an unsafe shell command;
- complete a task without unnecessary iterations.

Measure:

- task success rate;
- tool-call accuracy;
- unnecessary tool calls;
- fallback rate;
- time to first token;
- total latency;
- token usage;
- regressions between versions.

The current synthetic benchmark is a starting point, but real task fixtures should become the main quality gate.

## 8. User-facing product quality

Once runtime behavior is solid:

- improve setup and provider configuration;
- add `harmony doctor`;
- add `harmony run "<task>"`;
- provide clear model selection and pinning;
- support non-interactive CI mode;
- make logs and session locations configurable;
- document security boundaries and data handling;
- provide stable exit codes for automation.

