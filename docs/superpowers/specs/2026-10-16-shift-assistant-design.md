# Shift assistant and insights strip

Date: 2026-10-16. Status: draft for approval. Mockup: option C, refined (`.superpowers/brainstorm/…/assistant-panel-v2.html`, local only).

## Why

The floor views carry a lens switcher (Status, Clearing order, Exceptions, Cameras) that adds little for someone watching the demo, while the useful AI features (briefing, efficiency ideas, ask-the-shift) sit in a manager-only tab that disappears whenever a table is selected or a Next steps card is followed. Ask-the-shift answers one question at a time from a fixed snapshot, keeps no conversation, and is typed only.

A restaurant manager uses this on the floor with one hand free during service, and sitting down after closing to review the night. The assistant should feel like something you can talk to, that knows tonight's numbers, and that can suggest an action you approve with one tap.

## Goals

1. **Assistant tab** in the left column, next to Waitlist and Tables: a streaming, multi-turn chat about the shift.
   - Mainly analytics: "which table is slowing us down", "why did parties wait around 7", "how did tonight go", "what should we change".
   - The AI looks data up while it answers (tools), instead of reading one fixed snapshot. The answer shows small chips naming what it looked up ("Read shift metrics", "Checked clearing queue").
   - Answers are short text, plus a small bar chart or table when numbers help.
   - **Proposed actions:** when the conversation leads to something actionable, the assistant proposes it as an amber card (title, one-line why, Confirm / Not now). Nothing changes until Confirm. Confirm runs the action through the existing action path (`useActions` in `lib/api/board.tsx`), as the current persona, with the same rules, idempotency and error feedback as the buttons. The result (done, or the rule that refused it) is reported back into the conversation.
   - **Voice input:** a "Hold to talk" mic button. Words appear in the input as they are recognised; releasing sends. Spoken questions are marked "Spoken" in the thread.
   - **Read answers aloud:** a toggle in the panel header. When on, each finished answer is spoken. Each answer also has a Replay control and Copy.
   - Suggested questions as quiet chips above the input.
2. **Insights strip** where the lens switcher was, above the floor: live shift numbers (average wait, departure to ready, ready to seated, parties waiting now) and a **Shift report** link that opens the existing briefing, efficiency ideas, metrics and CSV export in a dialog.
3. **Remove** the lens switcher and the floor note ("Floor plan built from Camera 02." / "Illustrative layout…").
4. Works in the live outlet and in the recorded replay. In the replay, the assistant reads and acts on that viewer's replay session only.
5. **Manager only.** The Assistant tab and the Insights strip appear only in the Manager view. Host and Floor staff keep their current left column and simply lose the lens switcher and the floor note.
6. **Manager comes first.** The top bar order becomes Manager, Host, Floor staff, and every default entry point opens the Manager view: the landing page's live-demo link and its other app links, the `/demo` redirect (`App.tsx`), the not-found page's links and the archived demo page's link (`/host?source=replay` → `/manager?source=replay`). In the Manager view the left column opens on the Assistant tab.
7. **Recorded replay is the only mode in the UI.** The "seeded demo floor" (live outlet without cameras) is no longer offered:
   - Landing page: remove both "Open the demo floor" buttons and the sentence contrasting the live demo with the demo floor. The role cards ("Pick one to open the demo floor") and the closing Host / Manager links open that role's view of the recorded replay instead, with copy adjusted to match.
   - Header: remove the *Live outlet | Recorded replay* switch (`features/replay/ReplayControls.tsx`), the "Demo data" badge and the "Updated just now" freshness label (`components/brand/StatusChrome.tsx`).
   - Opening `/manager`, `/host` or `/staff` without `?source=replay` behaves as the replay (start dialog, then the session). The live-outlet API and the camera gateway stay in the backend, untouched; only the UI stops offering them.
   - The connection-problem states that the freshness indicator also carried ("Updates delayed", offline pausing actions) remain where they are needed; only the routine "Updated …" label goes. *(Builder's call.)*

## Non-goals

- The assistant does not act on its own. Next steps stays the proactive surface during service.
- No new kinds of action. Proposals cover only actions the API already has: table actions (confirm departure, mark ready, dismiss review, block/unblock), task actions (claim, start, complete), seating a waiting party at a ready table (hold then confirm), and party actions (cancel, left). There is no "assign a task to someone else" action today, so the assistant cannot propose one.
- No chat history saved on the server or across reloads.
- No sign-in, no per-user limits beyond those below.
- Vision pipeline and the recorded timeline are untouched.

## Anti-goals (would be a failure even if it works)

- An action that changes table state without the manager tapping Confirm.
- Invented numbers, tables or parties. Every figure comes from a tool result; when data is thin the assistant says so.
- Emoji, sparkle icons or chat-bot gimmicks. Same type, colours and line icons as the rest of the app.
- Breaking the existing Docker/Caddy deployment or the local `pnpm dev` setup.

## Constraints

- Frontend: Vite + React 19 on Vercel. Backend: FastAPI on one server, one process, behind Caddy at `VITE_BACKEND_URL`. The frontend already calls the backend cross-origin with CORS.
- Gemini is the only model provider (`GEMINI_API_KEY`, model fallback list in `backend/turnwise/gemini.py`). The key stays on the backend.
- The API has no auth, so the chat endpoint must bound cost: cap on conversation length and tool steps per request.
- Demo sessions: everything under `/api/demo` is scoped by the `X-Demo-Session` header and the demo app's dependency override, so a route added to the shared routers is scoped for free.

## How it's built (decided in conversation)

- **Placement:** option C. Assistant is a tab of the left column (`SideList` in `routes/FloorApp.tsx`), on desktop, tablet and phone, in the Manager view only. Insights strip takes the lens switcher's place, Manager view only.
- **Manager first:** nav order Manager, Host, Floor staff; default entry points land on Manager.
- **Vercel AI SDK:** used for the chat UI and streaming (`useChat` from `@ai-sdk/react`, message parts for text, tool steps and proposals, client-side tool results for Confirm / Not now).
- **Voice:** "Hold to talk", live words in the input, a "Read answers aloud" toggle.

## Builder's calls (made by Claude, open to change)

- **Where the model runs: the Python backend, not a Vercel function.** A new `POST /outlets/{id}/assistant` route streams the AI SDK UI message stream protocol (Server-Sent Events) from FastAPI, using `google-genai` streaming with function calling. Reasons: the key stays on one server; tools call the domain services directly instead of over HTTP; the demo-session scoping works unchanged; local dev and the Docker deployment need nothing new. The AI SDK is used in full on the client. Verify the protocol against the installed `ai` major version (v7 at the time of writing).
- **Read tools (run on the backend):** shift metrics for a window (reusing `briefing_facts`), board summary, clearing queue, waitlist, one table's detail and evidence, recent events. Read-only.
- **Proposal tool (no server execute):** `propose_action` with a typed input (action kind, ids, a one-line reason). The stream ends that step; the client renders the card; Confirm runs the action via `useActions` and returns the outcome as the tool result; Not now returns "declined". The chat then continues automatically.
- **Voice input:** the browser's built-in speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`, interim results on). The mic is hidden where the browser lacks it (Firefox). No audio reaches our server.
- **Read aloud:** the browser's `speechSynthesis`. The toggle state is remembered per browser.
- **Limits:** at most 24 messages per request, at most 5 tool steps per answer, question length 500 characters. The existing Gemini fallback and "Gemini is busy" failure apply.
- **Old ask-the-shift:** the `/ask` card is removed from the Shift report; the endpoint can stay until nothing calls it.
- **Shift report dialog:** reuses `ShiftOverview` minus the Ask card. The manager-only right-side shift panel and the replay rail's Shift tab are removed, since the strip and dialog replace them.
- **Charts:** a small horizontal bar list drawn with plain elements, no chart library.

## Open for the builder

- Exact tool schemas and the system prompt.
- Visual details within the mockup's direction, including phone layout of the strip.
- Tests: backend tests for the stream framing, the tool loop and the limits (Gemini mocked); a typecheck and a manual browser pass for the UI.
