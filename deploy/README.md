# Demo deployment: AWS server + Firestore

One server runs two containers: `api` (FastAPI, single process, Firestore persistence) and `web` (Caddy: static web app, `/api` proxy, automatic HTTPS). Camera detection stays on the on-site Mac and posts to `https://<site>/api/observations`. There is no sign-in; the persona switcher sets the acting role.

## 1. Firebase project (once)

1. Create a Firebase project and add a Firestore database in Native mode (for example `asia-southeast1`).
2. Project settings → Service accounts → Generate new private key. Put its JSON on one line in the root `.env` as `FIREBASE_SERVICE_ACCOUNT_JSON='...'` (the `.env` is gitignored).
3. Optional: in the Google Cloud console, Firestore → Time-to-live, add a policy on collection group `observations`, field `expire_at` (90-day metadata retention).

The API reads Firestore once at startup and then only writes; board polling costs no Firestore reads.

## 2. Server (AWS Lightsail or EC2)

- Ubuntu 24.04, 2 GB RAM, Singapore region, static IP, firewall open on 22, 80 and 443.
- Install Docker: `curl -fsSL https://get.docker.com | sh`
- Point a domain at the static IP, or use `<ip-with-dashes>.sslip.io` (no DNS setup needed). Caddy obtains the HTTPS certificate.

```sh
git clone <repo> turnwise && cd turnwise
cp .env.example .env    # set SITE_ADDRESS, GOOGLE_CLOUD_PROJECT, FIREBASE_SERVICE_ACCOUNT_JSON, TURNWISE_GATEWAY_TOKEN
# the live demo video is not in git: create apps/web/public/demo-media/mixkit-720p.mp4 first (see README)
docker compose -f deploy/docker-compose.yml up -d --build
curl https://<SITE_ADDRESS>/api/healthz
```

Update: `git pull && docker compose -f deploy/docker-compose.yml up -d --build`. The first start with an empty Firestore seeds the demo outlet; later starts load it. To reset the demo, delete the `outlets/demo-outlet` document tree in the Firestore console and restart `api`.

Run exactly one `api` container: it keeps the working state in memory and is the only Firestore writer.

## 3. On-site camera gateway (Mac)

```sh
cd backend
# root .env on the Mac: same TURNWISE_GATEWAY_TOKEN, TURNWISE_API_URL=https://<SITE_ADDRESS>/api
uv run --group vision python -m turnwise.gateway --loop
```

The annotated preview stays on the Mac (`http://127.0.0.1:8001/preview/...`); it is not proxied by the server.

## Local check against the Firestore emulator

Needs JDK 21. From the repository root: `pnpm emulators`, then in `backend`:
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 uv run pytest` (includes the persistence tests), or run the API with `TURNWISE_STORAGE=firestore GOOGLE_CLOUD_PROJECT=demo-turnwise FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
