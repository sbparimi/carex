// Account pages: log in, sign up (two steps), forgot password, reset password (ADR-005).
// No inline scripts or styles (strict CSP). The server validates everything again; checks here are for speed and clarity.
import { safeBrand } from "./theme.js";
import { bannerHtml, esc, fetchMe, safeNext, tenantSlug, type Banner } from "./common.js";
import type { BrandConfig } from "@carex/contracts";

type Page = "login" | "signup" | "forgot" | "reset";
const page = document.body.dataset.page as Page;
const root = document.getElementById("app")!;
document.body.classList.add("auth");
const slug = tenantSlug();
const API = `/t/${slug}/api`;
const nextUrl = () => safeNext(new URLSearchParams(location.search).get("next"));

const S = {
  brand: undefined as BrandConfig | undefined, step: 1, busy: false, banner: undefined as Banner,
  v: {} as Record<string, string>, errors: {} as Record<string, string>,
  access: "" as "" | "employer" | "insurer", employer: undefined as { id: string; name: string } | undefined,
  employerResults: [] as { id: string; name: string }[], employerSearched: false, insurers: [] as { id: string; name: string }[], insurerId: "",
  done: false, challenge: "",
};

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const r = await fetch(API + path, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    return { status: r.status, body: (r.status === 204 ? {} : await r.json()) as T };
  } finally { clearTimeout(t); }
}

// ---- small view helpers
const val = (id: string) => S.v[id] ?? "";
const EYE = `<svg class="i-show" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg><svg class="i-hide" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 21 21 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
/** Outlined input whose label floats onto the border (always a real <label for>). */
function field(id: string, label: string, type: string, ac: string, opts: { hint?: string; required?: boolean; extra?: string } = {}): string {
  const err = S.errors[id];
  const describedBy = [opts.hint ? `${id}-hint` : "", err ? `${id}-err` : ""].filter(Boolean).join(" ");
  const input = `<input id="${id}" name="${id}" type="${type}" value="${esc(val(id))}" placeholder=" " autocomplete="${ac}"${opts.required === false ? "" : " required"}${err ? ' aria-invalid="true"' : ""}${describedBy ? ` aria-describedby="${describedBy}"` : ""}>`;
  const eye = type === "password" ? `<button type="button" class="eye" data-act="togglePw" data-for="${id}" aria-label="Show password" aria-pressed="false">${EYE}</button>` : "";
  return `<div class="mb-md"><div class="ff${type === "password" ? " has-eye" : ""}">${input}<label for="${id}">${esc(label)}<span aria-hidden="true">*</span></label>${eye}</div>${opts.hint ? `<p class="hint" id="${id}-hint">${esc(opts.hint)}</p>` : ""}${err ? `<div class="err" id="${id}-err" role="alert">${esc(err)}</div>` : ""}</div>`;
}
const busyBtn = (label: string, busyLabel: string) => `<button type="submit" class="primary wide"${S.busy ? " disabled" : ""}>${S.busy ? busyLabel : label}</button>`;
const brandName = () => S.brand?.displayName ?? "";
const support = () => { const b = S.brand; const m = b?.supportEmail ? `mailto:${b.supportEmail}` : b?.supportPhone ? `tel:${b.supportPhone}` : ""; return m ? `<a href="${esc(m)}">Tech support?</a>` : ""; };

// ---- pages
function codeView(): string {
  return `<h1 tabindex="-1" id="h">Check your email</h1><p class="lead">We sent a 6-digit code to your email. It expires in 10 minutes.</p>${bannerHtml(S.banner)}
<form id="f" novalidate>${field("code", "6-digit code", "text", "one-time-code", { hint: "Enter the code exactly as shown in the email." }).replace('type="text"', 'type="text" inputmode="numeric" maxlength="6" pattern="[0-9]*"')}${busyBtn("Verify", "Verifying…")}</form><p class="alt"><a href="/t/${slug}/login${location.search}">Start over</a></p>`;
}
function loginView(): string {
  if (S.challenge) return codeView();
  return `<h1 tabindex="-1" id="h">Welcome</h1><p class="lead">Please log in to your ${esc(brandName())} account</p>${bannerHtml(S.banner)}
<form id="f" novalidate>${field("email", "Email address", "email", "username")}${field("password", "Password", "password", "current-password")}
<p class="links"><a href="/t/${slug}/forgot">Forgot password?</a> ${support()}</p>${busyBtn("Continue", "Logging in…")}</form>
<p class="alt">Need a ${esc(brandName())} account? <a href="/t/${slug}/signup${location.search}">Sign up</a></p>`;
}

function accessView(): string {
  const emp = S.access === "employer", ins = S.access === "insurer";
  const e = S.errors.access ? `<div class="err" id="access-err" role="alert">${esc(S.errors.access)}</div>` : "";
  return `<fieldset class="mb-md"><legend>How are you accessing ${esc(brandName())}?</legend>
<label class="radio"><input type="radio" name="access" value="employer"${emp ? " checked" : ""}> <span>Through an employer</span></label>
${emp ? `<div class="subfield"><label class="field" for="employer">Employer</label><input id="employer" type="text" value="${esc(S.employer?.name ?? val("employer"))}" autocomplete="off" aria-describedby="employer-hint"${S.errors.access ? ' aria-invalid="true"' : ""}>
<p class="hint" id="employer-hint">${S.employerSearched ? "" : "Please begin typing your employer's name to see options"}</p>
<p class="sr-only" role="status" aria-live="polite">${S.employerSearched && !S.employer ? `${S.employerResults.length} matching employers` : ""}</p>
${S.employerResults.length && !S.employer ? `<ul class="results">${S.employerResults.map((r) => `<li><button type="button" class="linkish" data-act="pickEmployer" data-id="${esc(r.id)}" data-name="${esc(r.name)}">${esc(r.name)}</button></li>`).join("")}</ul>` : S.employerSearched && !S.employer ? `<p class="hint">No employers match. Check the spelling, or choose the insurance option if that is how you are covered.</p>` : ""}</div>` : ""}
<label class="radio"><input type="radio" name="access" value="insurer"${ins ? " checked" : ""}> <span>Through an insurance provider, not an employer</span></label>
${ins ? `<div class="subfield"><label class="field" for="insurer">Insurance provider</label><select id="insurer"${S.errors.access ? ' aria-invalid="true"' : ""}><option value="">Select your insurance provider</option>${S.insurers.map((i) => `<option value="${esc(i.id)}"${S.insurerId === i.id ? " selected" : ""}>${esc(i.name)}</option>`).join("")}</select></div>` : ""}${e}</fieldset>`;
}

function signupView(): string {
  const back = `<button type="button" class="linkish back" data-act="back" aria-label="Back">← Back</button>`;
  const bar = `<div class="progress" role="progressbar" aria-label="Sign-up progress" aria-valuemin="1" aria-valuemax="2" aria-valuenow="${S.step}"><div class="bar step${S.step}"></div></div>`;
  if (S.step === 1) {
    return `${bar}<h1 tabindex="-1" id="h">Let's get started. Please provide your information.</h1><p class="lead">First and last name must match your records.</p>${bannerHtml(S.banner)}
<form id="f" novalidate>${field("firstName", "First name", "text", "given-name")}${field("lastName", "Last name", "text", "family-name")}
<div class="two">${field("dateOfBirth", "Date of birth", "date", "bday")}${field("phone", "Mobile phone number", "tel", "tel")}</div>${accessView()}
<button type="submit" class="primary wide">Next</button></form><p class="alt"><a href="/t/${slug}/login${location.search}">I already have an account.</a></p>`;
  }
  return `${bar}${back}<h1 tabindex="-1" id="h">Create your login</h1><p class="lead">You will use this email and password to book and manage appointments.</p>${bannerHtml(S.banner)}
<form id="f" novalidate>${field("email", "Email address", "email", "email")}${field("password", "Password", "password", "new-password", { hint: "At least 10 characters. A few random words make a strong password." })}
${busyBtn("Create account", "Creating account…")}</form>`;
}

function forgotView(): string {
  if (S.done) return `<h1 tabindex="-1" id="h">Check your email</h1>${bannerHtml({ kind: "success", text: "If that email has an account, we have sent a link to reset the password. The link works once and expires in 30 minutes." })}<p class="alt"><a href="/t/${slug}/login">Back to log in</a></p>`;
  return `<h1 tabindex="-1" id="h">Forgot your password?</h1><p class="lead">Enter your email address and we will send you a link to choose a new one.</p>${bannerHtml(S.banner)}<form id="f" novalidate>${field("email", "Email address", "email", "username")}${busyBtn("Send reset link", "Sending…")}</form><p class="alt"><a href="/t/${slug}/login">Back to log in</a></p>`;
}

function resetView(): string {
  if (S.done) return `<h1 tabindex="-1" id="h">Password updated</h1>${bannerHtml({ kind: "success", text: "Your password has been changed and you have been signed out everywhere." })}<p class="alt"><a href="/t/${slug}/login">Log in</a></p>`;
  return `<h1 tabindex="-1" id="h">Choose a new password</h1>${bannerHtml(S.banner)}<form id="f" novalidate>${field("password", "New password", "password", "new-password", { hint: "At least 10 characters." })}${busyBtn("Change password", "Saving…")}</form>`;
}

function render(focus = true, keep?: string) {
  root.setAttribute("aria-busy", "false");
  const body = { login: loginView, signup: signupView, forgot: forgotView, reset: resetView }[page]();
  root.innerHTML = `<main class="authcard"><div class="authbrand"><span class="mark" aria-hidden="true"></span><span class="authbrand-name">${esc(brandName())}</span></div>${body}</main>`;
  document.title = `${brandName() ? brandName() + " – " : ""}${{ login: "Log in", signup: "Sign up", forgot: "Forgot password", reset: "Reset password" }[page]}`;
  if (keep) { const el = document.getElementById(keep) as HTMLInputElement | null; el?.focus(); if (el && "setSelectionRange" in el && el.type === "text") { try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* not supported for this type */ } } }
  else if (focus) (document.querySelector('[aria-invalid="true"]') as HTMLElement | null ?? document.getElementById("h"))?.focus();
}

// ---- actions
const emailOk = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e.trim());
function serverError(r: { status: number; body: any }, fallback: string) {
  const e = r.body?.error;
  S.errors = e?.fields ?? {};
  S.banner = { kind: "error", text: r.status === 429 ? "Too many attempts. Please wait a minute and try again." : r.status >= 500 ? "Something went wrong on our side. Please try again." : (e?.message ?? fallback) };
}

async function submit() {
  if (S.busy) return;
  S.errors = {}; S.banner = undefined;
  try {
    if (page === "login" && S.challenge) {
      if (!/^\d{6}$/.test(val("code").trim())) { S.errors.code = "Enter the 6-digit code"; return render(); }
      S.busy = true; render(false);
      const r = await call("POST", "/auth/verify-login", { challenge: S.challenge, code: val("code").trim() }); S.busy = false;
      if (r.status === 200) return void location.assign(nextUrl());
      S.v.code = ""; serverError(r, "That code isn't right or has expired."); return render();
    }
    if (page === "login") {
      if (!emailOk(val("email"))) S.errors.email = "Enter your email address"; if (!val("password")) S.errors.password = "Enter your password";
      if (Object.keys(S.errors).length) return render();
      S.busy = true; render(false);
      const r = await call("POST", "/auth/login", { email: val("email").trim(), password: val("password") }); S.busy = false;
      if (r.status === 200 && r.body?.mfa?.challenge) { S.challenge = r.body.mfa.challenge; S.v.code = ""; S.v.password = ""; return render(); }
      if (r.status === 200) return void location.assign(nextUrl());
      S.errors = {}; S.v.password = ""; serverError(r, "Invalid email or password"); return render();
    }
    if (page === "forgot") {
      if (!emailOk(val("email"))) { S.errors.email = "Enter your email address"; return render(); }
      S.busy = true; render(false);
      const r = await call("POST", "/auth/forgot-password", { email: val("email").trim() }); S.busy = false;
      if (r.status === 202) { S.done = true; return render(); }
      serverError(r, "We couldn't send the link"); return render();
    }
    if (page === "reset") {
      const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("token") ?? "";
      if (!token) { S.banner = { kind: "error", text: "This reset link is incomplete. Request a new one." }; return render(); }
      S.busy = true; render(false);
      const r = await call("POST", "/auth/reset-password", { token, password: val("password") }); S.busy = false;
      if (r.status === 204) { S.done = true; history.replaceState(null, "", location.pathname); return render(); }
      serverError(r, "This reset link is invalid or has expired."); return render();
    }
    // sign up
    if (S.step === 1) {
      if (!val("firstName").trim()) S.errors.firstName = "Enter your first name"; if (!val("lastName").trim()) S.errors.lastName = "Enter your last name";
      if (!val("dateOfBirth")) S.errors.dateOfBirth = "Enter your date of birth"; if (!/^[0-9+() .-]{7,20}$/.test(val("phone").trim())) S.errors.phone = "Enter a valid mobile phone number";
      if (!S.access) S.errors.access = "Tell us how you are accessing care"; else if (S.access === "employer" && !S.employer) S.errors.access = "Choose your employer from the list"; else if (S.access === "insurer" && !S.insurerId) S.errors.access = "Choose your insurance provider";
      if (Object.keys(S.errors).length) return render();
      S.step = 2; return render();
    }
    if (!emailOk(val("email"))) S.errors.email = "Enter a valid email address"; if (val("password").length < 10) S.errors.password = "Use at least 10 characters";
    if (Object.keys(S.errors).length) return render();
    S.busy = true; render(false);
    const r = await call("POST", "/auth/signup", {
      email: val("email").trim(), password: val("password"), firstName: val("firstName").trim(), lastName: val("lastName").trim(), dateOfBirth: val("dateOfBirth"), phone: val("phone").trim(),
      access: S.access === "employer" ? { type: "employer", employerId: S.employer!.id } : { type: "insurer", insurerId: S.insurerId },
    }); S.busy = false;
    if (r.status === 201) return void location.assign(nextUrl());
    serverError(r, "We couldn't create your account");
    if (["firstName", "lastName", "dateOfBirth", "phone", "access"].some((k) => S.errors[k])) S.step = 1;
    return render();
  } catch { S.busy = false; S.banner = { kind: "error", text: "We couldn't reach the server. Please check your connection and try again." }; render(); }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
async function searchEmployers(q: string) {
  if (!q.trim()) { S.employerResults = []; S.employerSearched = false; return render(false, "employer"); }
  try { const r = await call<{ employers: { id: string; name: string }[] }>("GET", `/auth/employers?q=${encodeURIComponent(q.trim())}`); S.employerResults = r.body.employers ?? []; S.employerSearched = true; }
  catch { S.employerResults = []; S.employerSearched = false; }
  if (document.activeElement && (document.activeElement as HTMLElement).id === "employer") render(false, "employer");
}

root.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
root.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "employer") { S.v.employer = t.value; S.employer = undefined; clearTimeout(searchTimer); searchTimer = setTimeout(() => void searchEmployers(t.value), 200); return; }
  if (t.id) S.v[t.id] = t.value;
});
root.addEventListener("change", async (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  if (t.name === "access") {
    S.access = t.value as "employer" | "insurer"; S.errors.access = "";
    if (S.access === "insurer" && S.insurers.length === 0) { try { S.insurers = (await call<{ insurers: { id: string; name: string }[] }>("GET", "/auth/insurers")).body.insurers; } catch { S.insurers = []; } }
    render(false); (document.querySelector(`input[name="access"][value="${S.access}"]`) as HTMLElement | null)?.focus(); return;
  }
  if (t.id === "insurer") S.insurerId = t.value;
});
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button[data-act]") as HTMLElement | null; if (!b) return;
  if (b.dataset.act === "togglePw") {
    const input = document.getElementById(b.dataset.for!) as HTMLInputElement; const show = input.type === "password";
    input.type = show ? "text" : "password"; b.setAttribute("aria-label", show ? "Hide password" : "Show password"); b.setAttribute("aria-pressed", String(show)); return;
  }
  if (b.dataset.act === "pickEmployer") { S.employer = { id: b.dataset.id!, name: b.dataset.name! }; S.employerResults = []; S.errors.access = ""; render(false, "employer"); return; }
  if (b.dataset.act === "back") { S.step = 1; S.banner = undefined; render(); }
});

(async function boot() {
  try {
    const cfg = await fetch(`${API}/config`);
    if (cfg.status !== 200) throw new Error("no tenant");
    S.brand = ((await cfg.json()) as { brand: BrandConfig }).brand;
    document.documentElement.style.setProperty("--brand", safeBrand(S.brand.primaryColor));
  } catch {
    root.setAttribute("aria-busy", "false");
    root.innerHTML = `<main><h1 tabindex="-1" id="h">This page isn't available</h1><p class="lead">Please check the link or contact the clinic directly.</p></main>`;
    document.title = "Unavailable"; (document.getElementById("h") as HTMLElement).focus(); return;
  }
  if ((page === "login" || page === "signup") && (await fetchMe())) { location.replace(nextUrl()); return; }
  render();
})();
