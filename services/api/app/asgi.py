"""Uvicorn entry point: `uvicorn app.asgi:app`. Settings are read from the environment."""

import logging

from app.main import create_app

# uvicorn only configures its own loggers; without this the app's INFO logs are dropped.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = create_app()
