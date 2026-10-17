"""Vercel entry point: exposes the ASGI app. All logic lives in the carex package."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from carex.wsgi import app  # noqa: E402,F401
