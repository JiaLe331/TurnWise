# Demo deployment: Google Cloud Run + Firestore

Two Cloud Run services in one GCP project: `turnwise-api` (FastAPI, single process, Firestore persistence) and `turnwise-web` (Caddy: static web app, `/api` proxy). Camera detection stays on the on-site Mac and, if used, posts to `https://<web-url>/api/observations`. There is no sign-in; the persona switcher sets the acting role.

## 1. Project and Firestore (once)

1. Use a GCP project with billing enabled, and enable the Run, Cloud Build, Artifact Registry, Secret Manager and Firestore APIs.
2. Create a Firestore database in Native mode (for example `asia-southeast1`). The first start with an empty Firestore seeds the demo outlet; to reset the demo, delete the `outlets/demo-outlet` document tree in the Firestore console and restart `turnwise-api`.
3. Grant the Cloud Run runtime service account `roles/datastore.user`. The API then uses its own identity for Firestore, so no key file is needed. Outside Cloud Run, set `FIREBASE_SERVICE_ACCOUNT_JSON` (one line) in the root `.env`.
4. Optional: Firestore → Time-to-live, add a policy on collection group `observations`, field `expire_at` (90-day metadata retention).

The API reads Firestore once at startup and then only writes; board polling costs no Firestore reads.

## 2. Deploy to Cloud Run

The API uses the Cloud Run service account for Firestore. The web service is not a plain Firebase Hosting rewrite, which keeps the `/api` prefix the backend does not expect.

```sh
P=<project-id>; R=asia-southeast1

# Gemini key as a secret; the runtime service account must be able to read it (roles/secretmanager.secretAccessor)
printf '%s' "$GEMINI_API_KEY" | gcloud secrets create gemini-key --data-file=- --project $P

# API: exactly one instance (in-memory state, single Firestore writer), always allocated CPU. Run from backend/.
(cd backend && gcloud run deploy turnwise-api --source . --project $P --region $R --port 8000 \
  --allow-unauthenticated --max-instances 1 --min-instances 1 --no-cpu-throttling --memory 1Gi \
  --set-env-vars TURNWISE_STORAGE=firestore,GOOGLE_CLOUD_PROJECT=$P \
  --set-secrets GEMINI_API_KEY=gemini-key:latest)

# Web: create apps/web/public/demo-media/mixkit-720p.mp4 first (not in git); .gcloudignore keeps it in the upload.
IMG=$R-docker.pkg.dev/$P/cloud-run-source-deploy/turnwise-web
gcloud builds submit . --project $P --region $R --config deploy/cloudbuild-web.yaml --substitutions _IMAGE=$IMG
gcloud run deploy turnwise-web --image $IMG --project $P --region $R --port 8080 --allow-unauthenticated \
  --set-env-vars API_URL=$(gcloud run services describe turnwise-api --project $P --region $R --format='value(status.url)')
```

Open the `turnwise-web` URL. Cloud Run reserves `/healthz` on `*.run.app`, so check the API through the web URL (`/api/outlets/demo-outlet/board`) or `/openapi.json`. `TURNWISE_GATEWAY_TOKEN` is left unset, which disables the live camera gateway (`gateway_disabled`); the recorded replay does not need it.

## 3. On-site camera gateway (Mac, optional)

Not needed for the recorded replay. Set `TURNWISE_GATEWAY_TOKEN` on the API (a Secret Manager secret) to enable it; unset, gateway requests are rejected with `gateway_disabled`.

```sh
cd backend
# root .env on the Mac: same TURNWISE_GATEWAY_TOKEN, TURNWISE_API_URL=https://<web-url>/api
uv run --group vision python -m turnwise.gateway --loop
```

The annotated preview stays on the Mac (`http://127.0.0.1:8001/preview/...`); it is not proxied.

## Local check against the Firestore emulator

Needs JDK 21. From the repository root: `pnpm emulators`, then in `backend`:
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 uv run pytest` (includes the persistence tests), or run the API with `TURNWISE_STORAGE=firestore GOOGLE_CLOUD_PROJECT=demo-turnwise FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
