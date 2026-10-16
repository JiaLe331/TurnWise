# TurnWise

TurnWise is a restaurant table-operations assistant. The [product requirements](docs/Restaurant_Table_Operations_PRD.md) define the intended workflow. This repository currently contains a local-first project scaffold, not an operational system.

## Requirements

- Node.js 24 and pnpm 11 for the web app and Firebase CLI
- Python 3.12 and [uv](https://docs.astral.sh/uv/) for the API
- JDK 21 or newer to run the Firestore emulator (firebase-tools 15 requires it)

The web app and API start without a Firebase project or cloud credentials. The Firebase CLI is installed through the root JavaScript dependencies. Java is not installed on the initial development machine, so install a JDK before starting the emulators.

## Start locally

```sh
npm exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
make dev
```

`make dev` uses npm to run the project's pinned pnpm version, so a global pnpm installation is not required.

`pnpm dev` starts the API on port 8000 and the web app on port 5173 together, with both logs in one terminal; Ctrl+C stops both. `uv run` installs the Python dependencies on first use. To run one side on its own, use `pnpm dev:api` or `pnpm dev:web`. Restarting the API resets the demo data.

Open `http://localhost:5173` for the introduction page, a scroll-driven walkthrough that follows one table through a turn on a sample floor, or go straight to `/host`, `/staff` or `/manager`. Each view shows the outlet as a 3D floor model next to a table list and an inspector, using live data from the API. Table positions in the model are illustrative: zones and capacities come from the API, but there are no floor coordinates yet. Use **Grid view** on the floor to switch to a plain tile grid (also used automatically without WebGL). In development, the identity menu in the header picks who is acting (`host-1`, `staff-ana`, `staff-ben`, `manager-1`) and sends the temporary actor headers; production builds send no identity unless built with `VITE_DEMO_IDENTITY=true` (the demo deployment does), in which case the persona switcher works without sign-in. The API exposes `GET /healthz` and interactive documentation at `http://127.0.0.1:8000/docs`. The manual table workflow is active against a seeded in-memory outlet (`demo-outlet`, 14 tables, reset on restart): `GET /outlets/{id}/board`, `POST /tables/{id}/actions` and `POST /tasks/{id}/actions`. Mutations need an `Idempotency-Key` header and, until Firebase Auth is added, `X-Actor-Id` and `X-Actor-Role` (`host`, `floor_staff`, `manager`) headers. The host seating workflow is active too: `GET`/`POST /parties` and `POST /parties/{id}/actions` (update, cancel, left) manage an anonymous waitlist; `GET /recommendations` returns up to three eligible ready tables for the oldest party that can be seated, with visible queue skips; `POST /seating-holds` creates a 60-second hold and `POST /seating-holds/{id}/actions` confirms (starting a new occupied session) or cancels it. Skipping an older waiting party, or seating at a camera-mapped table without current evidence, needs an `override_reason`. Hosts and managers manage parties and holds. The board now includes `waitlist` and active `holds`, and the clearing queue ranks tasks that can seat the oldest compatible waiting party first. Observations are ingested from the local vision service (see below). `GET /outlets/{id}/metrics?start=&end=` returns shift metrics derived from audit events (confirmed-departure-to-ready, review-to-confirmation, ready-to-seated, queue wait by party size, vision-review correction rate and event counts; default window the last 12 hours), and `format=csv` exports the underlying cycle rows.

### Vision replay (Task C)

The local vision process replays a recorded CCTV clip at 1x, runs RF-DETR Nano on each processed frame, maps detections to the tables in `backend/config/cameras/cctv-01.json`, and posts interval summaries to `POST /observations`. Only the API changes table state: 30 seconds of continuous, valid vacancy evidence requests a departure review, and staff still confirm the departure. Download the clip once (it is gitignored), then start the API and the gateway with the same token:

```sh
cd backend
curl -L -o recordings/restaurant-cctv-sample.mp4 "https://github.com/anuj1611/ai-restaurant-cctv-monitoring/raw/main/sample%20video.mp4"
TURNWISE_GATEWAY_TOKEN=dev-local uv run uvicorn turnwise.api.main:app --port 8000
TURNWISE_GATEWAY_TOKEN=dev-local uv run --group vision python -m turnwise.gateway   # second terminal
```

The first gateway run downloads the model weights. The gateway serves the annotated preview on port 8001: `GET /preview/cameras/cctv-01` returns run metadata and `GET /preview/cameras/cctv-01/stream` returns MJPEG. Pass `--loop` to restart the clip when it ends (each pass is a new replay run, so evidence starts fresh) and `--no-publish` to show the preview without writing to the API. Board entries now include an `evidence` block with source, freshness (`stale` after 60 seconds without observations) and `review_source`. The camera mapping (version 4) covers 9 visible tables, calibrated from detected seating positions across the clip. The far side of the room is also run through the detector as a 2x upscaled tile (`detail_tiles`), which raises distant guests from 3–50% to 79–100% of frames at about 7 fps on this Mac. One partly hidden table by the left wall stays manual. The sample clip contains no departure, so the review flow is covered by the FakeClock tests in `tests/test_observations.py`.

After installing Java, start the local Authentication and Firestore emulators from the repository root:

```sh
pnpm emulators
```

The emulator project ID is `demo-turnwise`. Firestore rules deny client access until outlet-scoped authorization is implemented. The emulator startup is independent of the web and API smoke test.

Settings live in one gitignored `.env` at the repository root (copy `.env.example`). The API and the camera gateway load it at startup, and real environment variables take precedence. With `TURNWISE_STORAGE=firestore`, the API persists to the project in `GOOGLE_CLOUD_PROJECT` using the service-account JSON in `FIREBASE_SERVICE_ACCOUNT_JSON` (or the emulator via `FIRESTORE_EMULATOR_HOST`); the default `memory` storage resets on restart. Tests always use memory storage.

## Checks

```sh
pnpm typecheck
pnpm build
cd backend
uv run pytest
uv run ruff check .
```

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Host, floor staff, and manager web shell |
| `backend/turnwise/domain` | Table, task, and audit rules behind a repository interface (in-memory for now) |
| `backend/turnwise/api` | FastAPI HTTP entrypoint and future PRD route modules |
| `backend/turnwise/gateway` | Future on-site frame capture boundary |
| `backend/turnwise/worker` | Future observation interpretation boundary |
| `backend/turnwise/contracts.py` | Initial states and data contracts from the PRD |
| `firebase.json`, `firestore.rules` | Local emulator configuration and closed client rules |

The next implementation stage is the PRD's manual workflow: authentication and outlet roles, mapped tables, queue, tasks, staff confirmations, and audit events, with idempotency and version checks on mutations. Camera observations, recommendations, holds, analytics, and cloud deployment follow after that workflow is validated.

## Demo deployment

See [deploy/README.md](deploy/README.md): one AWS server running the API (Firestore persistence, `TURNWISE_STORAGE=firestore`) and the web app behind Caddy, with no sign-in (the build sets `VITE_DEMO_IDENTITY=true` so the persona switcher works in production).

## Live demo (recorded replay)

The landing page's **Watch the live demo** opens `/host?source=replay` (`/demo` redirects there): the host, staff and manager views switch from the live outlet to a recorded replay built on a stock time-lapse of a real dining room (Mixkit 4385). The header's *Live outlet | Recorded replay* switch moves between the two. Each browser tab gets its own isolated session under `/api/demo`; the video player drives a demo clock (20 simulated seconds per media second), and a precomputed timeline replays detections, smoothed table states and Gemini table checks through the normal observation rules. Nothing touches the live outlet.

- **Modes:** *Autoplay walkthrough* lets a server-side autopilot act as staff and host at the moments the footage shows (T3 turnover, T2 departure and reset, the party of six seated at T4), with captions. *Guided* pauses on each camera or Gemini event so the viewer acts as host, floor staff or manager. Modes can be switched while playing.
- **Views:** the footage with table-zone overlays sits in a column beside the floor, with next steps (the AI guide), the shift log and, for managers, the shift overview with the Gemini briefing, efficiency ideas and ask-the-shift. The floor switches between 3D, a 2D plan and a grid, using the room's shape (bar, banquette, table column). Switching views keeps the same session and switches who you act as.
- **Original demo page:** archived at `/demo/classic`.
- **Video file (not in git, per the Mixkit licence):** create it once with
  `ffmpeg -i backend/recordings/mixkit-minimalist-restaurant-4385.mp4 -vf "scale=1280:720,minterpolate=fps=96:mi_mode=mci:mc_mode=aobmc:vsbmc=1" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -an -movflags +faststart apps/web/public/demo-media/mixkit-720p.mp4`
  (download the source clip from https://mixkit.co/free-stock-video/customers-in-a-minimalist-style-restaurant-4385/ into `backend/recordings/`).
- **Timeline:** `backend/demo/mixkit-timeline.json` is committed. Regenerate it with `uv run --group vision python scripts/build_demo_timeline.py` from `backend` (needs `GEMINI_API_KEY` for the table checks).
- **Gemini:** set `GEMINI_API_KEY` in `.env`. Calls fall back across several Flash models and fail soft with a "Gemini is busy" message when every model is over quota.
