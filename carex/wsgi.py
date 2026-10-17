"""ASGI entry point: `uvicorn carex.wsgi:app`. Reads DATABASE_URL / CAREX_DB and the other settings from the environment (and a local .env file)."""
from .app import create_app
from .ops import load_dotenv

load_dotenv()
app = create_app()
