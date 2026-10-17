"""Patient accounts: sign-up (employer/insurer door), password login with lockout, optional emailed second step, sessions, reset, notification choices."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Callable, Protocol

from .util import iso, ms, now as _now, parse, sha256, token as new_token

MAX_FAILED, LOCK_MS = 5, 15 * 60_000
SESSION_MS, TOUCH_MS, MFA_MS, MFA_ATTEMPTS, RESET_MS = 24 * 3_600_000, 60_000, 10 * 60_000, 5, 30 * 60_000
_N, _R, _P = 16384, 8, 1
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{43}$")


class AccountError(Exception):
    def __init__(self, code: str, message: str, fields: dict | None = None):
        super().__init__(message)
        self.code, self.fields = code, fields or {}


class Mailer(Protocol):
    def send_password_reset(self, to: str, tenant_slug: str, token: str) -> None: ...
    def send_login_code(self, to: str, tenant_name: str, code: str) -> None: ...


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    key = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=64, maxmem=64 * 1024 * 1024)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(key)}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        alg, n, r, p, salt, key = stored.split("$")
        if alg != "scrypt":
            return False
        want = _unb64(key)
        got = hashlib.scrypt(pw.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(want), maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(got, want)
    except Exception:
        return False


_DUMMY = None


def _dummy() -> str:
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("carex-dummy-password-for-timing")
    return _DUMMY


def normalize_email(e: str) -> str:
    return e.strip().lower()


def password_problem(pw, email: str | None = None) -> str | None:
    if not isinstance(pw, str):
        return "Password is required"
    if len(pw) < 10:
        return "Use at least 10 characters"
    if len(pw) > 128:
        return "Use at most 128 characters"
    if email and pw.lower() == email.lower():
        return "Password must not be your email address"
    if re.fullmatch(r"(.)\1+", pw):
        return "Choose a less repetitive password"
    return None


def _dob_problem(dob, at: datetime) -> str | None:
    if not isinstance(dob, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", dob):
        return "Enter your date of birth"
    try:
        d = parse(dob + "T00:00:00Z")
    except ValueError:
        return "Enter a real date"
    if d.year < 1900 or d > at:
        return "Enter a real date of birth"
    try:
        adult = d.replace(year=d.year + 18)
    except ValueError:
        adult = d.replace(year=d.year + 18, day=28)
    if adult > at:
        return "You must be 18 or older to create an account"
    return None


class Accounts:
    def __init__(self, db, clock: Callable[[], datetime] = _now, mailer: Mailer | None = None):
        self.db, self.now, self.mailer = db, clock, mailer

    def employers(self, tenant_id: str, q: str) -> list[dict]:
        term = re.sub(r"[\\%_]", "", q.strip().lower())
        if not term:
            return []
        return self.db.all("SELECT id, name FROM employers WHERE tenant_id = ? AND lower(name) LIKE ? ORDER BY name LIMIT 10", tenant_id, f"%{term}%")

    def insurers(self, tenant_id: str) -> list[dict]:
        return self.db.all("SELECT id, name FROM insurers WHERE tenant_id = ? ORDER BY name", tenant_id)

    def signup(self, tenant_id: str, *, email, password, first_name, last_name, date_of_birth, phone, access_type, access_id) -> tuple[dict, str]:
        f: dict[str, str] = {}
        em = normalize_email(email) if isinstance(email, str) else ""
        if not re.fullmatch(r"[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}", em) or len(em) > 254:
            f["email"] = "Enter a valid email address"
        pw = password_problem(password, em)
        if pw:
            f["password"] = pw
        ok = lambda v: isinstance(v, str) and 1 <= len(v.strip()) <= 80
        if not ok(first_name):
            f["first_name"] = "Enter your first name"
        if not ok(last_name):
            f["last_name"] = "Enter your last name"
        d = _dob_problem(date_of_birth, self.now())
        if d:
            f["date_of_birth"] = d
        if not isinstance(phone, str) or not re.fullmatch(r"[0-9+() .\-]{7,20}", phone.strip()):
            f["phone"] = "Enter a valid mobile phone number"
        employer_id = insurer_id = None
        access_name = ""
        if access_type == "employer":
            e = self.db.get("SELECT id, name, verification, email_domain FROM employers WHERE tenant_id = ? AND id = ?", tenant_id, str(access_id))
            if not e:
                f["access"] = "Choose your employer from the list"
            else:
                employer_id, access_name = e["id"], e["name"]
                if "email" not in f and e["verification"] == "domain" and e["email_domain"] and not em.endswith("@" + e["email_domain"]):
                    f["email"] = f"Use your {e['name']} work email (ends with @{e['email_domain']})"
                if "email" not in f and e["verification"] == "roster" and not self.db.get("SELECT 1 AS ok FROM employer_roster WHERE employer_id = ? AND email = ?", e["id"], em):
                    f["email"] = f"We couldn't find this email on {e['name']}'s member list. Use the email your employer has on file."
        elif access_type == "insurer":
            e = self.db.get("SELECT id, name FROM insurers WHERE tenant_id = ? AND id = ?", tenant_id, str(access_id))
            if not e:
                f["access"] = "Choose your insurance provider from the list"
            else:
                insurer_id, access_name = e["id"], e["name"]
        else:
            f["access"] = "Tell us how you are accessing care"
        if f:
            raise AccountError("invalid_input", "Please check the highlighted fields", f)
        uid = str(uuid.uuid4())
        try:
            self.db.run("""INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, date_of_birth, phone, access_type, employer_id, insurer_id, created_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", uid, tenant_id, em, hash_password(password), first_name.strip(), last_name.strip(), date_of_birth, phone.strip(),
                        "employer" if employer_id else "insurer", employer_id, insurer_id, iso(self.now()))
        except Exception as e:
            if self.db.is_unique(e):
                raise AccountError("email_taken", "An account with this email already exists. Try logging in.", {"email": "An account with this email already exists"})
            raise
        return self.profile_by_id(tenant_id, uid), self._new_session(tenant_id, uid)

    def login(self, tenant_id: str, email: str, password: str) -> tuple[dict, str]:
        r = self.begin_login(tenant_id, email, password)
        if r.get("mfa"):
            raise AccountError("invalid_credentials", "A verification code is required")
        return r["profile"], r["token"]

    def begin_login(self, tenant_id: str, email_raw: str, password: str) -> dict:
        em = normalize_email(email_raw) if isinstance(email_raw, str) else ""
        u = None
        if isinstance(password, str) and len(password) <= 128:
            u = self.db.get("SELECT id, password_hash, failed_logins, locked_until FROM users WHERE tenant_id = ? AND email = ?", tenant_id, em)
        if not u:
            verify_password(str(password)[:128], _dummy())      # same work and same answer for unknown emails
            raise AccountError("invalid_credentials", "Invalid email or password")
        if u["locked_until"] and ms(u["locked_until"]) > ms(self.now()):
            raise AccountError("locked", "Too many failed attempts. Try again in a few minutes, or reset your password.")
        if not verify_password(password, u["password_hash"]):
            n = u["failed_logins"] + 1
            self.db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", 0 if n >= MAX_FAILED else n,
                        iso(self.now() + timedelta(milliseconds=LOCK_MS)) if n >= MAX_FAILED else None, u["id"])
            raise AccountError("invalid_credentials", "Invalid email or password")
        self.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", u["id"])
        t = self.db.get("SELECT mfa_required, display_name FROM tenants WHERE id = ?", tenant_id)
        if t and t["mfa_required"] == 1:
            return {"mfa": {"challenge": self._start_challenge(tenant_id, u["id"], em, t["display_name"])}}
        return {"profile": self.profile_by_id(tenant_id, u["id"]), "token": self._new_session(tenant_id, u["id"])}

    def logout(self, tenant_id: str, token: str | None) -> None:
        if token:
            self.db.run("DELETE FROM sessions WHERE token_hash = ? AND tenant_id = ?", sha256(token), tenant_id)

    def authenticate(self, tenant_id: str, token: str | None) -> dict | None:
        """The signed-in profile for a session cookie value, or None (missing, unknown, expired, other tenant)."""
        if not token or not _TOKEN.match(token):
            return None
        s = self.db.get("SELECT s.user_id, s.expires_at, s.last_seen_at, s.created_at, t.session_idle_minutes AS idle FROM sessions s JOIN tenants t ON t.id = s.tenant_id WHERE s.token_hash = ? AND s.tenant_id = ?",
                        sha256(token), tenant_id)
        if not s:
            return None
        now = ms(self.now())
        last = ms(s["last_seen_at"] or s["created_at"])
        if ms(s["expires_at"]) <= now or now - last > s["idle"] * 60_000:
            self.db.run("DELETE FROM sessions WHERE token_hash = ?", sha256(token))
            return None
        if now - last > TOUCH_MS:
            self.db.run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", iso(self.now()), sha256(token))
        return self.profile_by_id(tenant_id, s["user_id"])

    # ---- password reset
    def request_reset(self, tenant_id: str, tenant_slug: str, email_raw: str) -> None:
        em = normalize_email(email_raw) if isinstance(email_raw, str) else ""
        u = self.db.get("SELECT id FROM users WHERE tenant_id = ? AND email = ?", tenant_id, em)
        if not u:
            return                                              # same visible result either way
        tok = new_token()
        self.db.run("INSERT INTO password_resets (token_hash, user_id, tenant_id, expires_at) VALUES (?,?,?,?)", sha256(tok), u["id"], tenant_id, iso(self.now() + timedelta(milliseconds=RESET_MS)))
        if self.mailer:
            self.mailer.send_password_reset(em, tenant_slug, tok)

    def reset_password(self, tenant_id: str, token: str, new_password: str) -> None:
        p = password_problem(new_password)
        if p:
            raise AccountError("invalid_input", p, {"password": p})
        h = hash_password(new_password)
        with self.db.tx() as tx:
            r = tx.get(f"SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ? AND tenant_id = ?{tx.for_update}", sha256(token), tenant_id) if isinstance(token, str) else None
            if not r or r["used_at"] or ms(r["expires_at"]) <= ms(self.now()):
                raise AccountError("invalid_token", "This reset link is invalid or has expired. Request a new one.")
            tx.run("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", iso(self.now()), sha256(token))
            tx.run("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ? AND tenant_id = ?", h, r["user_id"], tenant_id)
            tx.run("DELETE FROM sessions WHERE user_id = ?", r["user_id"])      # a reset signs out every device

    # ---- second step: a 6-digit code emailed to the account, valid 10 minutes, 5 tries, single use
    def _start_challenge(self, tenant_id: str, user_id: str, email: str, tenant_name: str) -> str:
        ch = secrets.token_urlsafe(24)
        code = f"{secrets.randbelow(1_000_000):06d}"
        self.db.run("INSERT INTO mfa_challenges (token_hash, user_id, tenant_id, code_hash, expires_at) VALUES (?,?,?,?,?)",
                    sha256(ch), user_id, tenant_id, sha256(f"{ch}:{code}"), iso(self.now() + timedelta(milliseconds=MFA_MS)))
        if self.mailer:
            self.mailer.send_login_code(email, tenant_name, code)
        return ch

    def verify_login(self, tenant_id: str, challenge: str, code: str) -> tuple[dict, str]:
        bad = AccountError("invalid_credentials", "That code is wrong or has expired. Sign in again to get a new one.")
        if not isinstance(challenge, str) or not isinstance(code, str) or not re.fullmatch(r"\d{6}", code.strip()) or len(challenge) > 100:
            raise bad
        uid = None
        with self.db.tx() as tx:
            c = tx.get(f"SELECT user_id, code_hash, expires_at, attempts, used_at FROM mfa_challenges WHERE token_hash = ? AND tenant_id = ?{tx.for_update}", sha256(challenge), tenant_id)
            if c and not c["used_at"] and c["attempts"] < MFA_ATTEMPTS and ms(c["expires_at"]) > ms(self.now()):
                ok = hmac.compare_digest(sha256(f"{challenge}:{code.strip()}"), c["code_hash"])
                tx.run("UPDATE mfa_challenges SET attempts = attempts + 1, used_at = ? WHERE token_hash = ?", iso(self.now()) if ok else None, sha256(challenge))
                uid = c["user_id"] if ok else None
        if not uid:
            raise bad
        return self.profile_by_id(tenant_id, uid), self._new_session(tenant_id, uid)

    def set_notify(self, tenant_id: str, user_id: str, email: bool | None = None, sms: bool | None = None) -> None:
        """SMS is opt-in only (consent to text messages)."""
        if isinstance(email, bool):
            self.db.run("UPDATE users SET notify_email = ? WHERE tenant_id = ? AND id = ?", 1 if email else 0, tenant_id, user_id)
        if isinstance(sms, bool):
            self.db.run("UPDATE users SET notify_sms = ? WHERE tenant_id = ? AND id = ?", 1 if sms else 0, tenant_id, user_id)

    def _new_session(self, tenant_id: str, user_id: str) -> str:
        tok = new_token()
        t = self.now()
        self.db.run("INSERT INTO sessions (token_hash, user_id, tenant_id, created_at, expires_at, last_seen_at) VALUES (?,?,?,?,?,?)",
                    sha256(tok), user_id, tenant_id, iso(t), iso(t + timedelta(milliseconds=SESSION_MS)), iso(t))
        return tok

    def profile_by_id(self, tenant_id: str, uid: str) -> dict | None:
        r = self.db.get("""SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth, u.phone, u.access_type, u.employer_id, u.insurer_id, u.notify_email, u.notify_sms,
                                  e.name AS ename, i.name AS iname
                             FROM users u LEFT JOIN employers e ON e.id = u.employer_id LEFT JOIN insurers i ON i.id = u.insurer_id
                            WHERE u.tenant_id = ? AND u.id = ?""", tenant_id, uid)
        if not r:
            return None
        emp = r["access_type"] == "employer"
        return {"id": r["id"], "email": r["email"], "first_name": r["first_name"], "last_name": r["last_name"], "date_of_birth": r["date_of_birth"], "phone": r["phone"],
                "access": {"type": r["access_type"], "id": r["employer_id"] if emp else r["insurer_id"], "name": r["ename"] if emp else r["iname"]},
                "notify": {"email": r["notify_email"] == 1, "sms": r["notify_sms"] == 1}}
