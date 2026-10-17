"""Vercel entry point: exposes the ASGI app. All logic lives in the carex package."""
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from carex.wsgi import app  # noqa: F401
except Exception as exc:  # startup failed: say why, safely, instead of an opaque 500
    traceback.print_exc()
    _msg = re.sub(r"postgres(?:ql)?://\S+", "postgresql://<hidden>", f"{type(exc).__name__}: {exc}")[:600]

    async def app(scope, receive, send):  # minimal ASGI app
        if scope["type"] != "http":
            return
        body = ("CareX could not start.\n\n" + _msg + "\n").encode()
        await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"text/plain; charset=utf-8"), (b"cache-control", b"no-store")]})
        await send({"type": "http.response.body", "body": body})
