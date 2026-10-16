# Shift Assistant and Insights Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Manager view a streaming, voice-capable shift assistant (Vercel AI SDK chat backed by Gemini tools on the FastAPI backend) and an insights strip, and simplify the UI to a replay-only, manager-first demo.

**Architecture:** A new FastAPI route streams the AI SDK UI message stream protocol (SSE, `x-vercel-ai-ui-message-stream: v1`) from a Gemini function-calling loop over read-only tools that slice the existing `briefing_facts`. The frontend uses `useChat` from `@ai-sdk/react` with a transport pointed at the current API scope (live or demo session). `propose_action` has no server execution: the client renders a confirm card, runs the action through the existing `useActions`, and returns the outcome with `addToolOutput`, which re-sends automatically.

**Tech Stack:** FastAPI, google-genai, pytest; React 19, Vite, `ai@7.0.142`, `@ai-sdk/react@4.0.146`, browser SpeechRecognition and speechSynthesis.

**Spec:** `docs/superpowers/specs/2026-10-16-shift-assistant-design.md`

## Global Constraints

- Gemini key stays on the backend; no new provider.
- Limits: at most 24 messages per request, at most 5 tool steps per answer, last user message at most 500 characters.
- Assistant tab and Insights strip: Manager view only. Nav order: Manager, Host, Floor staff. Default entry points land on `/manager?source=replay`.
- No emoji or sparkle icons in new UI; lucide line icons, existing tokens (`tokens.css`), Young Serif only where the app already uses it.
- Nothing changes table state without the manager pressing Confirm.
- Existing Docker/Caddy deployment and `pnpm dev` keep working (same-origin `/api` when `VITE_BACKEND_URL` is empty).
- Tests: `cd backend && uv run pytest && uv run ruff check .`; `pnpm typecheck && pnpm build` from the repo root.

## Review Focus

1. Gemini busy or over quota mid-chat: the user sees a plain "Gemini is busy, try again in a minute" error in the thread, and the composer stays usable. Test: `test_assistant_all_models_fail_streams_error`.
2. A proposed action the role rules refuse (version conflict, already claimed): the card shows the refusal and the assistant is told, so it doesn't claim success. Covered by the card's `onError` path returning the error text via `addToolOutput` (manual check in Task 6).
3. Replay session changes (restart, leave) while a chat is open: the chat resets instead of posting to a dead session. Assistant panel is keyed by `apiScopeKey()` (Task 4).
4. Browser without speech recognition (Firefox) or mic permission denied: mic button hidden, or an inline "Microphone blocked" note; typing still works (Task 5).
5. The model loops on tools: stops after 5 tool steps and answers with what it has. Test: `test_assistant_caps_tool_steps`.

---

### Task 1: Backend assistant stream

**Files:**
- Create: `backend/turnwise/domain/assistant.py`
- Modify: `backend/turnwise/api/routers/metrics.py` (new route)
- Test: `backend/tests/test_assistant.py`

**Interfaces:**
- Produces: `POST /outlets/{outlet_id}/assistant` (also under `/demo`), body `{"messages": UIMessage[]}` (the AI SDK `useChat` request body; extra keys ignored), response `text/event-stream` with headers `x-vercel-ai-ui-message-stream: v1`, `cache-control: no-cache`, `x-accel-buffering: no`.
- Produces tool names (the frontend renders parts `tool-<name>`): `get_shift_metrics`, `get_floor_now`, `get_recent_events`, `get_table`, `show_chart`, `propose_action`.
- `show_chart` input/output: `{"title": str, "unit": str, "bars": [{"label": str, "value": float}]}` (max 8 bars), echoed as output.
- `propose_action` input: `{"kind": "table"|"task"|"seat"|"party", "action": str, "table_id": str|None, "task_id": str|None, "party_id": str|None, "title": str, "reason": str}`. `action` is a `TableAction`, `TaskAction` or `PartyAction` value (`cancel`|`left`); for `seat` it is `"seat"`. No output from the server.

- [ ] **Step 1: Write failing tests** with Gemini replaced by a fake: monkeypatch `turnwise.domain.assistant._stream_model(model, contents, config)` to yield scripted events, and set `GEMINI_API_KEY=x`. Parse the SSE body into JSON chunks.
  - `test_assistant_streams_text`: script yields text "T4 is slowest." → chunk types in order `start, start-step, text-start, text-delta, text-end, finish-step, finish`, and the body ends with `data: [DONE]`; response header `x-vercel-ai-ui-message-stream == "v1"`.
  - `test_assistant_runs_server_tool_then_answers`: step 1 calls `get_floor_now`, step 2 yields text → stream contains `tool-input-available` (toolName `get_floor_now`) then `tool-output-available` whose output has key `tables_by_state`, then text.
  - `test_assistant_stops_on_propose_action`: script calls `propose_action` → stream has `tool-input-available` for it, no `tool-output-available` for that `toolCallId`, then `finish-step`, `finish`.
  - `test_assistant_caps_tool_steps`: script always calls `get_floor_now` → exactly 5 `tool-output-available` chunks, then the final call is made with tools disabled (assert the fake saw `config.tools` empty on call 6) and its text is streamed.
  - `test_assistant_all_models_fail_streams_error`: fake raises on every model → one `error` chunk whose `errorText` contains "Gemini is busy", then `[DONE]`.
  - `test_assistant_limits`: 25 messages → 400; last user text of 501 chars → 400; no `GEMINI_API_KEY` → 503 `ai_unavailable`.
  - `test_assistant_history_flattens_tool_parts`: a request whose history has an assistant message with a `tool-propose_action` part (state `output-available`, output `{"status":"done","detail":"T4 marked ready"}`) → the contents passed to the fake contain a model-role text part mentioning "T4 marked ready" and no function-call parts from history.
  - `test_assistant_demo_scope`: POST `/demo/outlets/demo-outlet/assistant` with a started demo session header works (reuse the session fixture pattern in `tests/test_demo.py`).

- [ ] **Step 2: Run them, expect failure** — `cd backend && uv run pytest tests/test_assistant.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement `turnwise/domain/assistant.py`**
  - `def chat_stream(ctx: Context, messages: list[dict], start: datetime, end: datetime) -> Iterator[str]` yields SSE lines (`"data: " + json + "\n\n"`, ending `"data: [DONE]\n\n"`).
  - `def validate(messages: list[dict]) -> None` raises `BadRequest` for the limits; `gemini.configured()` false raises `AiUnavailable("The assistant")`.
  - `_stream_model(model: str, contents: list, config) -> Iterator[Event]` wraps `genai` `generate_content_stream`; `Event` is `("text", str)` or `("call", name, args: dict)`. Disable automatic function calling.
  - History conversion: user text → user `Content`; assistant text → model text; every past tool part becomes a short model text line (`"[looked up get_floor_now]"`, `"[proposed: <title> → <status>: <detail>]"`). Only the current request's loop uses native `function_call` / `function_response` parts (keeps Gemini 3 thought signatures valid).
  - Loop: up to 5 tool steps; each server tool call emits `tool-input-available` + `tool-output-available`, appends the model content and a `Part.from_function_response`; `propose_action` emits `tool-input-available` and ends the response. After 5 steps one more call with no tools.
  - Model fallback: iterate `gemini.models()`; a failure before any chunk of the current step is emitted moves to the next model; after output has started, or when all fail, emit `error` with "Gemini is busy or over quota right now. Try again in a minute."
  - Tools read from `briefing_facts(ctx, start, end)`: `get_shift_metrics(hours_back:int=12)` → `metrics_minutes, event_counts, vision_review_correction_rate, measurement_notes` (recompute the window from `hours_back`, clamp 1..24); `get_floor_now()` → `now_utc, tables_by_state, blocked_tables, waiting_parties, clearing_queue, unclaimed_clearing_tasks, stale_cameras_on_tables, gemini_table_checks`; `get_recent_events(limit:int=20)` → last `limit` (max 40) of `recent_events`; `get_table(table_id)` → `entry_for(ctx, id).model_dump(mode="json")` or `{"error": "unknown table"}`.
  - System prompt: manager's shift assistant; use tools for every number, never invent; short spoken-friendly answers (2–4 sentences); call `show_chart` when comparing 3+ numbers; call `propose_action` only for actions listed in its schema and only when it clearly helps; durations in minutes.
- [ ] **Step 4: Add the route** in `metrics.py`: `@router.post("/outlets/{outlet_id}/assistant")`, body model `ChatRequest(BaseModel, extra="ignore")` with `messages: list[dict]`; outlet check as siblings; `validate` before streaming; return `StreamingResponse(chat_stream(...), media_type="text/event-stream", headers={...})` with the window from `_window(services, None, None)`.
- [ ] **Step 5: Run tests** — `uv run pytest -q && uv run ruff check .` → all pass.
- [ ] **Step 6: Commit** `feat(api): stream a tool-using shift assistant in the AI SDK protocol`.

### Task 2: Replay-only, manager-first, and header/landing removals

**Files:**
- Modify: `apps/web/src/features/replay/ReplayProvider.tsx:51` (`wantsReplay` true on floor routes)
- Modify: `apps/web/src/routes/FloorApp.tsx` (NAV order; remove `DataModeBadge`, `SourceSwitch`, `SourcePill` usage; `IllustrativeNote` component and both usages)
- Modify: `apps/web/src/components/brand/StatusChrome.tsx` (`FreshnessIndicator` renders only for `delayed`; delete `DataModeBadge` if unused)
- Modify: `apps/web/src/features/replay/ReplayControls.tsx` (delete `SourceSwitch`, `SourcePill` if unused)
- Modify: `apps/web/src/routes/Landing.tsx`, `apps/web/src/App.tsx:25`, `apps/web/src/routes/NotFound.tsx`, `apps/web/src/routes/LiveDemo.tsx:110`, `README.md` (live demo section)

- [ ] **Step 1:** `wantsReplay = true` for the floor app (drop the `source` param check; keep writing `source=replay` harmless). The leave/"back to live" path, if any UI still calls it, should not be reachable; remove callers.
- [ ] **Step 2:** NAV order `manager, host, staff`. `/demo` redirect, landing `DEMO_HREF`, NotFound links, LiveDemo link → `/manager?source=replay`. Landing: delete both "Open the demo floor" buttons and the line-271 sentence; role cards and closing links go to `/<role>?source=replay`; reword line 191 to "Pick one to open the recorded replay as that role." Order role cards Manager first; update the Manager card copy to "Ask the shift assistant, review tonight's numbers, and act on what needs attention."
- [ ] **Step 3:** Remove header `DataModeBadge`, `SourceSwitch`, routine freshness label; remove `IllustrativeNote`. Delete now-unused exports.
- [ ] **Step 4:** `pnpm typecheck && pnpm build` → pass. Run `pnpm dev`, open `/`, `/manager`, `/host`: start dialog appears; header shows no switch/badge/"Updated"; nav starts with Manager.
- [ ] **Step 5: Commit** `feat(web): replay-only, manager-first demo without status chrome`.

### Task 3: Manager layout — left-column Assistant tab, Insights strip, Shift report dialog

**Files:**
- Create: `apps/web/src/features/insights/InsightsStrip.tsx`, `apps/web/src/features/insights/ShiftReportDialog.tsx`
- Modify: `apps/web/src/routes/FloorApp.tsx` (`ListTab` gains `'assistant'`, loses `'shift'`; manager default tab `'assistant'`; remove `LensSwitch` and lens state → fixed `'status'`; remove manager right-side `ShiftOverview` aside; strip in the switcher's place for managers)
- Modify: `apps/web/src/features/replay/GuideStrip.tsx` (`ReplayPanel` loses the `shift` tab and prop)
- Modify: `apps/web/src/features/manager/ShiftOverview.tsx` (remove the Ask card and its state)

**Interfaces:**
- Produces: `<InsightsStrip className? />` reads `shiftApi.metrics` (same query key ShiftOverview uses) and `useBoard()` waitlist; shows Avg wait (median of `queue_wait` durations, or "–"), Departure to ready, Ready to seated, Waiting now (waiting parties count); a "Shift report" button opens `<ShiftReportDialog open onOpenChange />` which renders `ShiftOverview`.
- Produces: `SideList` renders `<AssistantPanel />` (Task 4) when tab is `'assistant'`; until Task 4 lands, render a placeholder `div`.

- [ ] **Step 1:** Implement the strip and dialog using `components/ui/dialog.tsx`; values use `tabular`; the worst metric is not coloured (no thresholds exist).
- [ ] **Step 2:** Wire layout changes for desktop, tablet and phone (phone: strip scrolls horizontally above the floor).
- [ ] **Step 3:** `pnpm typecheck && pnpm build` → pass; manual check `/manager` desktop and a 390px-wide window.
- [ ] **Step 4: Commit** `feat(web): manager insights strip and shift report; drop lens switcher`.

### Task 4: Assistant chat panel (AI SDK)

**Files:**
- Modify: `apps/web/package.json` (add `ai@7.0.142`, `@ai-sdk/react@4.0.146`)
- Modify: `apps/web/src/lib/api/client.ts` (export `currentApiScope(): { base: string; headers: Record<string,string> }`)
- Create: `apps/web/src/features/assistant/AssistantPanel.tsx`, `apps/web/src/features/assistant/parts.tsx` (step chips, chart, message rendering)

**Interfaces:**
- Consumes: Task 1 route and tool names; `currentApiScope`, `apiScopeKey`, `OUTLET_ID`.
- Produces: `<AssistantPanel className? />`, mounted by `SideList` with `key={apiScopeKey()}`.

- [ ] **Step 1:** Install: `pnpm --filter @turnwise/web add ai@7.0.142 @ai-sdk/react@4.0.146`.
- [ ] **Step 2:** `useChat` with `new DefaultChatTransport({ api: 'unused', prepareSendMessagesRequest: ({ messages }) => { const s = currentApiScope(); return { api: \`${s.base}/outlets/${OUTLET_ID}/assistant\`, headers: s.headers, body: { messages: messages.slice(-24) } } } })`, `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`.
- [ ] **Step 3:** Render per mockup: header (context "Tonight, last 12 hours" and the read-aloud toggle slot), thread (user bubbles right, ink; assistant text plain; `tool-get_*` parts as small chips "Read shift metrics" / "Checked the floor" / "Read recent events" / "Looked up T4"; `tool-show_chart` as a horizontal bar list; `tool-propose_action` slot for Task 6), suggestion chips (How did tonight go? / What should we change? / Why did parties wait?), composer with input (maxLength 500), send button, mic slot. Error from `useChat` shown inline with a Retry (`regenerate()`). Empty state: one serif line "Ask about tonight's shift." and the chips.
- [ ] **Step 4:** `pnpm typecheck && pnpm build`; manual: ask "how did tonight go" in a replay with `GEMINI_API_KEY` set; text streams; chips and chart render.
- [ ] **Step 5: Commit** `feat(web): streaming shift assistant panel on the AI SDK`.

### Task 5: Voice input and read-aloud

**Files:**
- Create: `apps/web/src/features/assistant/speech.ts`
- Modify: `apps/web/src/features/assistant/AssistantPanel.tsx`

**Interfaces:**
- Produces: `useSpeechInput(onFinal: (text: string) => void): { supported: boolean; listening: boolean; interim: string; error: string | null; start(): void; stop(): void }` (wraps `SpeechRecognition ?? webkitSpeechRecognition`, `interimResults = true`, `lang = navigator.language`); `speak(text: string): void` and `stopSpeaking(): void` over `speechSynthesis`; `useReadAloud(): [boolean, (on: boolean) => void]` persisted in `localStorage` key `turnwise.readAloud` (try/catch).

- [ ] **Step 1:** Implement; mic is "Hold to talk" (pointer down → start, pointer up/leave → stop; Space/Enter toggles for keyboard). Interim text shows in the input; final text sends, and the user message gets `metadata: { spoken: true }` so the bubble shows "Spoken".
- [ ] **Step 2:** When read-aloud is on, speak each assistant message's text once when its status turns `ready`; each answer has Replay (speak) and Copy controls. Mic hidden when unsupported; `not-allowed` error shows "Microphone blocked. Allow it in the browser to talk."
- [ ] **Step 3:** `pnpm typecheck && pnpm build`; manual in Chrome: hold mic, speak, release → sends; toggle read-aloud → answer is spoken.
- [ ] **Step 4: Commit** `feat(web): hold-to-talk and read-aloud for the shift assistant`.

### Task 6: Proposed-action card

**Files:**
- Create: `apps/web/src/features/assistant/ProposalCard.tsx`
- Modify: `apps/web/src/lib/api/board.tsx` (`RunOptions.onSuccess?: (result: ActionResult) => void`; pass the result through; export `ActionResult`)
- Modify: `apps/web/src/features/assistant/parts.tsx`

**Interfaces:**
- Consumes: `propose_action` input (Task 1); `useActions().run`; `useBoard()` for current versions; `addToolOutput` from `useChat`.
- Produces: tool output `{ status: 'done' | 'declined' | 'failed', detail: string }`.

- [ ] **Step 1:** Map input to `ActionInput`: `table` → `{kind:'table', tableId, request:{action, expected_version: entry.session.version}}`; `task` → `{kind:'task', tableId, taskId, request:{action, expected_version: task.version}}`; `party` → `{kind:'party', partyId, queueCode, request:{action, expected_version: party.version}}`; `seat` → `hold-create` (`{party_id, table_id, ...}` as `useSeating` builds it), then on success `hold` confirm with the returned hold. Unknown ids → card shows "This no longer matches the floor" and returns `failed`.
- [ ] **Step 2:** Card per mockup (amber, "Proposed action", title, reason, Confirm / Not now). Confirm → `run(input, { success: title, onSuccess: () => addToolOutput({ tool: 'propose_action', toolCallId, output: { status: 'done', detail: title } }), onError: (e) => { addToolOutput({... status: 'failed', detail: describeError(e, subject) }); return false } })`. Not now → `declined`. After output the card shows its outcome, buttons gone. Disabled while `paused`.
- [ ] **Step 3:** `pnpm typecheck && pnpm build`; manual: ask "anything I should do about T4?" in a replay at a moment T4 needs clearing; confirm; board updates; the assistant acknowledges.
- [ ] **Step 4: Commit** `feat(web): confirm cards for assistant-proposed actions`.

### Task 7: Deploy and verify

- [ ] **Step 1:** Full checks (Global Constraints commands) pass.
- [ ] **Step 2:** rsync `backend/` to the server, `systemctl restart turnwise-api`; `curl -N -X POST .../api/outlets/demo-outlet/assistant` with one user message streams chunks.
- [ ] **Step 3:** Push to `main`; after Vercel deploys, browser pass on `https://turn-wise-eight.vercel.app/`: landing → Manager replay → Assistant answers, chart, proposal, voice in Chrome.
