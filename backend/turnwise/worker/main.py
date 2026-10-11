from fastapi import FastAPI

app = FastAPI(title="TurnWise Observation Worker", version="0.1.0")


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}
