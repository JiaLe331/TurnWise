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

Open `http://localhost:5173` for the introduction page, a scroll-driven walkthrough that follows one table on a sample floor (the camera-detection step is labelled as a concept), or go straight to `/host`, `/staff` or `/manager`. Each view shows the outlet as a 3D floor model next to a table list and an inspector, using live data from the API. Table positions in the model are illustrative: zones and capacities come from the API, but there are no floor coordinates yet. Use **Grid view** on the floor to switch to a plain tile grid (also used automatically without WebGL). In development, the identity menu in the header picks who is acting (`host-1`, `staff-ana`, `staff-ben`, `manager-1`) and sends the temporary actor headers; production builds send no identity, so the board is view-only until sign-in exists. The API exposes `GET /healthz` and interactive documentation at `http://127.0.0.1:8000/docs`. The manual table workflow is active against a seeded in-memory outlet (`demo-outlet`, 12 tables, reset on restart): `GET /outlets/{id}/board`, `POST /tables/{id}/actions` and `POST /tasks/{id}/actions`. Mutations need an `Idempotency-Key` header and, until Firebase Auth is added, `X-Actor-Id` and `X-Actor-Role` (`host`, `floor_staff`, `manager`) headers. Waitlist, recommendations, holds and observations are not exposed yet.

The separate worker HTTP shell can be started with `uv run uvicorn turnwise.worker.main:app --host 127.0.0.1 --port 8001` from `backend`. It only exposes a health endpoint. The gateway entrypoint (`uv run python -m turnwise.gateway`) exits with an explicit not-implemented message until capture is built.

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
