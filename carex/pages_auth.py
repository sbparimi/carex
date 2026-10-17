"""Sign-up, sign-in (with the optional emailed code), password reset, sign-out."""
from __future__ import annotations

import hashlib

from fastapi import Depends, FastAPI, Request
from fastapi.responses import PlainTextResponse

from .accounts import AccountError
from .web import COOKIE, SESSION_SECONDS, Web, form, s


def register(app: FastAPI, W: Web) -> None:
    c = W.c
    P = "/t/{slug}"

    def done(request, t, profile, token, nxt=""):
        W.audit(request, t, "user", "user.login", actor_id=profile["id"])
        r = W.redirect(W.safe_next(t["slug"], nxt) or f"/t/{t['slug']}/book")
        W.set_cookie(r, COOKIE, token, t["slug"], SESSION_SECONDS)
        return r

    @app.get(P + "/login")
    def login_page(slug: str, request: Request, notice: str = "", next: str = ""):
        t = W.tenant(slug)
        nxt = W.safe_next(slug, next)
        if W.user(request, t):
            return W.redirect(nxt or f"/t/{slug}/book")
        msgs = {"reset": "Your password was changed. Sign in with the new one.", "out": "You have been signed out."}
        return W.render(request, "login.html", t=t, notice=msgs.get(notice, ""), nxt=nxt)

    @app.post(P + "/login")
    def login(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        email = s(f, "email", 254).lower()
        W.allow("login_id", f"user:{t['id']}:{email}")
        try:
            r = c.accounts.begin_login(t["id"], email, f.get("password") or "")
        except AccountError as e:
            W.audit(request, t, "anonymous", "user.login_failed", detail={"email": hashlib.sha256(email.encode()).hexdigest()[:12]})
            return W.render(request, "login.html", 401 if e.code != "locked" else 423, t=t, error=str(e), email=email, nxt=W.safe_next(slug, s(f, "next", 600)))
        if r.get("mfa"):
            return W.render(request, "login.html", t=t, challenge=r["mfa"]["challenge"], nxt=W.safe_next(slug, s(f, "next", 600)))
        return done(request, t, r["profile"], r["token"], s(f, "next", 600))

    @app.post(P + "/login/verify")
    def verify(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        try:
            profile, token = c.accounts.verify_login(t["id"], s(f, "challenge", 100), s(f, "code", 10))
        except AccountError as e:
            return W.render(request, "login.html", 401, t=t, error=str(e), nxt=W.safe_next(slug, s(f, "next", 600)))
        return done(request, t, profile, token, s(f, "next", 600))

    @app.post(P + "/logout")
    def logout(slug: str, request: Request):
        t = W.tenant(slug)
        u = W.user(request, t)
        c.accounts.logout(t["id"], request.cookies.get(COOKIE))
        if u:
            W.audit(request, t, "user", "user.logout", actor_id=u["id"])
        r = W.redirect(f"/t/{slug}/login?notice=out")
        W.set_cookie(r, COOKIE, None, slug, 0)
        return r

    @app.get(P + "/signup")
    def signup_page(slug: str, request: Request, door: str = "", next: str = ""):
        t = W.tenant(slug)
        return W.render(request, "signup.html", t=t, nxt=W.safe_next(slug, next), **_signup_ctx(t, door, {}, {}))

    def _signup_ctx(t, door, v, errors):
        door = door if door in ("employer", "insurer") else ""
        options = []
        if door == "employer":
            options = c.db.all("SELECT id, name FROM employers WHERE tenant_id = ? ORDER BY name LIMIT 500", t["id"])
        elif door == "insurer":
            options = c.accounts.insurers(t["id"])
        return {"door": door, "options": options, "v": v, "errors": errors}

    @app.post(P + "/signup")
    def signup(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        door = s(f, "door", 20)
        try:
            profile, token = c.accounts.signup(t["id"], email=s(f, "email", 254), password=f.get("password") or "", first_name=s(f, "first_name", 100), last_name=s(f, "last_name", 100),
                                               date_of_birth=s(f, "date_of_birth", 10), phone=s(f, "phone", 30), access_type=door, access_id=s(f, "access_id", 64))
        except AccountError as e:
            v = {k: s(f, k, 254) for k in ("first_name", "last_name", "date_of_birth", "phone", "email", "access_id")}
            errors = dict(e.fields) or {"email": str(e)}
            return W.render(request, "signup.html", 400 if e.code == "invalid_input" else 409, t=t, nxt=W.safe_next(slug, s(f, "next", 600)), **_signup_ctx(t, door, v, errors))
        W.audit(request, t, "user", "user.signup", actor_id=profile["id"])
        r = W.redirect(W.safe_next(slug, s(f, "next", 600)) or f"/t/{slug}/book")
        W.set_cookie(r, COOKIE, token, slug, SESSION_SECONDS)
        return r

    @app.get(P + "/forgot")
    def forgot_page(slug: str, request: Request):
        return W.render(request, "forgot.html", t=W.tenant(slug))

    @app.post(P + "/forgot")
    def forgot(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        email = s(f, "email", 254).lower()
        W.allow("login_id", f"reset:{t['id']}:{email}")
        try:
            c.accounts.request_reset(t["id"], slug, email)
        except Exception:
            pass                                    # same visible result whether or not the address exists or mail failed
        return W.render(request, "forgot.html", t=t, sent=True)

    @app.get(P + "/reset")
    def reset_page(slug: str, request: Request, token: str = ""):
        t = W.tenant(slug)
        return W.render(request, "reset.html", t=t, token=token[:100])

    @app.post(P + "/reset")
    def reset(slug: str, request: Request, f: dict = Depends(form)):
        t = W.tenant(slug)
        W.allow("auth", W.client(request))
        token = s(f, "token", 100)
        try:
            c.accounts.reset_password(t["id"], token, f.get("password") or "")
        except AccountError as e:
            return W.render(request, "reset.html", 400, t=t, token=token, error=str(e))
        return W.redirect(f"/t/{slug}/login?notice=reset")
