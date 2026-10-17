"""Legal pages, a patient's account page (download my data, activity, close my account)."""
from __future__ import annotations

from fastapi import Depends, FastAPI, Request
from fastapi.responses import Response

from .web import Web, form, s

LEGAL = {"privacy": ("Privacy policy", "legal_privacy.html"), "terms": ("Terms of use", "legal_terms.html"), "notice-of-privacy-practices": ("Notice of privacy practices", "legal_npp.html")}


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}"

    @app.get(P + "/legal/{doc}")
    def legal(slug: str, doc: str, request: Request):
        from fastapi import HTTPException
        t = W.tenant(slug)
        if doc not in LEGAL:
            raise HTTPException(404, "Not found")
        title, tpl = LEGAL[doc]
        return W.render(request, tpl, t=t, user=W.user(request, t), staff=None, title=title, nav="")

    @app.get(P + "/account")
    def account(slug: str, request: Request, n: str = "", error: str = ""):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.audit(request, t, "user", "account.view", actor_id=u["id"])
        return W.render(request, "account.html", t=t, user=u, nav="account", activity=c.privacy.activity(t["id"], u["id"], 50), error=error[:160])

    @app.get(P + "/account/export.json")
    def export(slug: str, request: Request):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("auth", W.client(request))
        body = c.privacy.export_json(t["id"], u["id"])
        W.audit(request, t, "user", "account.export", actor_id=u["id"])
        return Response(body, media_type="application/json", headers={"content-disposition": 'attachment; filename="my-data.json"', "cache-control": "no-store", "x-content-type-options": "nosniff"})

    @app.post(P + "/account/delete")
    def delete(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        u = W.need_user(request, t)
        W.allow("auth", W.client(request))
        if s(f, "confirm", 20).strip().upper() != "DELETE" or not c.accounts.confirm_password(t["id"], u["id"], f.get("password") or ""):
            return W.redirect(f"/t/{slug}/account?error=Type DELETE and enter your password to close your account.")
        c.privacy.erase(t["id"], u["id"])
        r = W.redirect(f"/t/{slug}/login?notice=closed")
        from .web import COOKIE
        W.set_cookie(r, COOKIE, None, slug, 0)
        return r
