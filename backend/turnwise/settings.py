"""Load the repository-root .env into the environment. Real environment variables win."""

import os
from pathlib import Path

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"


def load_env(path: Path = ROOT_ENV) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)
