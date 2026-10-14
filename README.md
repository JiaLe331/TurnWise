# TurnWise

TurnWise is a restaurant table-operations assistant. The [product requirements](docs/Restaurant_Table_Operations_PRD.md) define the intended workflow. This repository currently contains a local-first project scaffold, not an operational system.

## Requirements

- Node.js 24 and pnpm 11 for the web app and Firebase CLI
- Python 3.12 and [uv](https://docs.astral.sh/uv/) for the API
- A supported Java JDK to run the Firestore emulator

The web app and API start without a Firebase project or cloud credentials. The Firebase CLI is installed through the root JavaScript dependencies. Java is not installed on the initial development machine, so install a JDK before starting the emulators.

## Start locally

```sh
npm exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
make dev
```

`make dev` uses npm to run the project's pinned pnpm version, so a global pnpm installation is not required.

`pnpm dev` starts the API on port 8000 and the web app on port 5173 together, with both logs in one terminal; Ctrl+C stops both. `uv run` installs the Python dependencies on first use. To run one side on its own, use `pnpm dev:api` or `pnpm dev:web`. Restarting the API resets the demo data.

Open `http://localhost:5173` for the introduction page, a scroll-driven walkthrough that follows one table on a sample floor (the camera-detection step is labelled as a concept), or go straight to `/host`, `/staff` or `/manager`. Each view shows the outlet as a 3D floor model next to a table list and an inspector, using live data from the API. Table positions in the model are illustrative: zones and capacities come from the API, but there are no floor coordinates yet. Use **Grid view** on the floor to switch to a plain tile grid (also used automatically without WebGL). In development, the identity menu in the header picks who is acting (`host-1`, `staff-ana`, `staff-ben`, `manager-1`) and sends the temporary actor headers; production builds send no identity, so the board is view-only until sign-in exists. The API exposes `GET /healthz` and interactive documentation at `http://127.0.0.1:8000/docs`. The manual table workflow is active against a seeded in-memory outlet (`demo-outlet`, 12 tables, reset on restart): `GET /outlets/{id}/board`, `POST /tables/{id}/actions` and `POST /tasks/{id}/actions`. Mutations need an `Idempotency-Key` header and, until Firebase Auth is added, `X-Actor-Id` and `X-Actor-Role` (`host`, `floor_staff`, `manager`) headers. The host seating workflow is active too: `GET`/`POST /parties` and `POST /parties/{id}/actions` (update, cancel, left) manage an anonymous waitlist; `GET /recommendations` returns up to three eligible ready tables for the oldest party that can be seated, with visible queue skips; `POST /seating-holds` creates a 60-second hold and `POST /seating-holds/{id}/actions` confirms (starting a new occupied session) or cancels it. Skipping an older waiting party, or seating at a camera-mapped table without current evidence, needs an `override_reason`. Hosts and managers manage parties and holds. The board now includes `waitlist` and active `holds`, and the clearing queue ranks tasks that can seat the oldest compatible waiting party first. Observations are ingested from the local vision service (see below). `GET /outlets/{id}/metrics?start=&end=` returns shift metrics derived from audit events (confirmed-departure-to-ready, review-to-confirmation, ready-to-seated, queue wait by party size, vision-review correction rate and event counts; default window the last 12 hours), and `format=csv` exports the underlying cycle rows.

### Vision replay (Task C)

The local vision process replays a recorded CCTV clip at 1x, runs RF-DETR Nano on each processed frame, maps detections to the tables in `backend/config/cameras/cctv-01.json`, and posts interval summaries to `POST /observations`. Only the API changes table state: 30 seconds of continuous, valid vacancy evidence requests a departure review, and staff still confirm the departure. Download the clip once (it is gitignored), then start the API and the gateway with the same token:

```sh
cd backend
curl -L -o recordings/restaurant-cctv-sample.mp4 "https://github.com/anuj1611/ai-restaurant-cctv-monitoring/raw/main/sample%20video.mp4"
TURNWISE_GATEWAY_TOKEN=dev-local uv run uvicorn turnwise.api.main:app --port 8000
TURNWISE_GATEWAY_TOKEN=dev-local uv run --group vision python -m turnwise.gateway   # second terminal
```

The first gateway run downloads the model weights. The gateway serves the annotated preview on port 8001: `GET /preview/cameras/cctv-01` returns run metadata and `GET /preview/cameras/cctv-01/stream` returns MJPEG. Pass `--no-publish` to show the preview without writing to the API. Board entries now include an `evidence` block with source, freshness (`stale` after 60 seconds without observations) and `review_source`. The table polygons (version 2) were calibrated from detected seating positions across the clip; T2 stays unmapped because its guest is rarely detected from this angle. The sample clip contains no departure, so the review flow is covered by the FakeClock tests in `tests/test_observations.py`.

After installing Java, start the local Authentication and Firestore emulators from the repository root:

```sh
pnpm emulators
```

The emulator project ID is `demo-turnwise`. Firestore rules deny client access until outlet-scoped authorization is implemented. The emulator startup is independent of the web and API smoke test.

The `.env.example` files reserve local connection settings for later integration. No cloud services or emulator data are accessed by the current web and API shells.

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
