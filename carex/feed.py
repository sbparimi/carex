"""Public, read-only booking feed for one organisation: its clinics and their next open times as JSON.

It carries no patient data. Search engines, AI assistants and partner sites can read it to offer the clinic's own slots, and every slot links back to the
organisation's own branded booking page, so the booking always happens under the clinic's name."""
from __future__ import annotations

from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .web import CSP_API, ID, SECURITY_HEADERS, Web
from .pages_staff2 import base_url_for

HEADERS = {**SECURITY_HEADERS, "content-security-policy": CSP_API, "cache-control": "public, max-age=30", "access-control-allow-origin": "*"}


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}/api"

    def reply(body: dict) -> JSONResponse:
        return JSONResponse(body, headers=HEADERS)

    def clinic_json(base: str, cl: dict) -> dict:
        return {"id": cl["id"], "name": cl["name"], "address": cl["address"], "city": cl["city"], "state": cl["state_code"], "time_zone": cl["time_zone"],
                "phone": cl["phone"] or None, "booking_url": f"{base}/book/provider?clinic={cl['id']}"}

    @app.get(P + "/clinics.json")
    def clinics(slug: str, request: Request, state: str = "", q: str = "", limit: int = 50):
        t = W.tenant(slug)
        W.allow("read", W.client(request))
        base = base_url_for(request, slug)
        state = state.upper()[:2]
        if not state and not q.strip():
            return reply({"organisation": t["brand"]["display_name"], "states": c.catalog.states(t["id"]), "hint": "Add ?state=TX or ?q=name to list clinics."})
        found = c.catalog.search_clinics(t["id"], q, state, limit=max(1, min(limit, 100)))
        return reply({"organisation": t["brand"]["display_name"], "clinics": [clinic_json(base, x) for x in found]})

    @app.get(P + "/availability.json")
    def availability(slug: str, request: Request, clinic: str = "", visit: str = "", per_provider: int = 5):
        t = W.tenant(slug)
        W.allow("read", W.client(request))
        if not ID.match(clinic or "") or (visit and not ID.match(visit)):
            raise HTTPException(400, "Invalid request")
        cl = c.catalog.clinic(t["id"], clinic)
        if not cl:
            raise HTTPException(404, "Not found")
        base = base_url_for(request, slug)
        n = max(1, min(per_provider, 20))
        out = []
        for v in c.catalog.visit_types(t["id"], clinic):
            if visit and v["id"] != visit:
                continue
            slots = []
            for p in c.catalog.providers(t["id"], clinic, v["id"]):
                for sl in c.booking.slots(t["id"], clinic, v["id"], p["id"])[:n]:
                    slots.append({"starts_at": sl["starts_at"], "provider": p["display_name"],
                                  "booking_url": f"{base}/book/details?clinic={clinic}&service={v['id']}&provider={p['id']}&slot={quote(sl['id'], safe='')}"})
            slots.sort(key=lambda x: x["starts_at"])
            out.append({"visit_type": v["label"], "visit_type_id": v["id"], "duration_min": v["duration_min"], "modality": v["modality"], "slots": slots})
        return reply({"organisation": t["brand"]["display_name"], "clinic": clinic_json(base, cl), "time_zone": cl["time_zone"], "times_in": "UTC", "visits": out})
