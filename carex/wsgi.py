"""ASGI entry point: `uvicorn carex.wsgi:app`. Reads the Neon DATABASE_URL and other settings from the environment (and a local .env file)."""
import re
import traceback

from .app import create_app
from .ops import load_dotenv

load_dotenv()
try:
    app = create_app()
except Exception as exc:  # startup failed: say why, safely, instead of an opaque 500
    traceback.print_exc()
    _msg = re.sub(r"postgres(?:ql)?://\S+", "postgresql://<hidden>", f"{type(exc).__name__}: {exc}")[:600]

    async def app(scope, receive, send):  # minimal ASGI app
        if scope["type"] != "http":
            return
        body = ("CareX could not start.\n\n" + _msg + "\n").encode()
        await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"text/plain; charset=utf-8"), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": body})
