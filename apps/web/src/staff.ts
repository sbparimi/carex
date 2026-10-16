// Staff console: day schedule, check-in, cancel/reschedule, book for a phone patient, time off and closures.
// Separate login and cookie from patients. The server enforces every role rule; this only hides what a role can't do.
import { bannerHtml, esc, fmtTime, type Banner } from "./common.js";

type Role = "front_desk" | "provider" | "admin";
interface Staff { id: string; name: string; email: string; role: Role; providerId: string | null }
interface Cat { staff: Staff; clinics: { id: string; name: string; timeZone: string; stateCode: string; visitTypes: { id: string; label: string; durationMin: number }[]; providers: { id: string; displayName: string; visitTypeIds: string[] }[] }[] }
interface Row { id: string; startsAt: string; endsAt: string; timeZone: string; status: string; clinicName: string; visitLabel: string; providerId: string; providerName: string; patientName: string; patientDob: string | null; phone: string | null; email: string | null; reason: string | null; modality: string; joinUrl: string | null; copayCents: number; accommodations: string | null; interpreterLanguage: string | null; referralRef: string | null; bookedBy: string; lateCancel: boolean }
interface Slot { id: string; startsAt: string }
type View = "loading" | "login" | "schedule" | "book" | "time";

const root = document.getElementById("app")!;
const slug = /^\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? "";
const API = `/t/${slug}/api/staff`;
const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const S = {
  view: "loading" as View, banner: undefined as Banner, busy: false, cat: undefined as Cat | undefined,
  date: "", clinicId: "", providerId: "", rows: [] as Row[], open: "", moveFor: "", moveSlots: [] as Slot[], cancelFor: "",
  book: { clinicId: "", serviceId: "", providerId: "", slotId: "", firstName: "", lastName: "", dob: "", phone: "", email: "", reason: "", screenOk: false, consent: false, smsOk: false, modality: "in_person", patientState: "" } as Record<string, string | boolean>,
  slots: [] as Slot[], timeOff: [] as { id: number; startsAt: string; endsAt: string }[], closures: [] as { id: number; startsAt: string; endsAt: string; reason: string }[],
  tof: { providerId: "", start: "", end: "", cStart: "", cEnd: "", cReason: "" } as Record<string, string>, email: "", password: "", exportFrom: "", exportTo: "",
};

async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(API + path, { method, headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
    if (r.status === 401 && S.view !== "login") { S.view = "login"; S.cat = undefined; render(); return new Promise(() => {}); }
    return { status: r.status, body: (r.status === 204 ? {} : await r.json()) as T };
  } finally { clearTimeout(t); }
}
const errText = (r: { status: number; body: any }, fb: string) => r.status === 403 ? "You don't have access to that." : r.status >= 500 ? "Something went wrong on our side. Nothing was changed." : r.body?.error?.message ?? fb;
const clinic = (id: string) => S.cat?.clinics.find((c) => c.id === id);
const role = () => S.cat?.staff.role;
const can = () => role() === "front_desk" || role() === "admin";
/** A clinic-local wall time ("2026-03-05T14:30") as a UTC ISO string. */
function zonedIso(local: string, tz: string): string {
  const [d, t] = local.split("T"); const [y, m, dd] = d!.split("-").map(Number); const [h, mi] = t!.split(":").map(Number);
  const guess = Date.UTC(y!, m! - 1, dd!, h!, mi!);
  const off = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)])); return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!) - ms; };
  let r = guess - off(guess); r = guess - off(r); return new Date(r).toISOString();
}

const btn = (act: string, label: string, o: { primary?: boolean; data?: string; disabled?: boolean } = {}) => `<button type="button"${o.primary ? ' class="primary"' : ""} data-act="${act}"${o.data ? ` data-id="${esc(o.data)}"` : ""}${o.disabled ? " disabled" : ""}>${esc(label)}</button>`;
const inp = (id: string, label: string, type = "text", extra = "") => `<label class="field" for="${id}">${esc(label)}</label><input id="${id}" data-k="${id}" type="${type}" value="${esc(String(S.book[id] ?? S.tof[id] ?? (id in S ? (S as any)[id] : "")))}" ${extra}>`;
const sel = (id: string, label: string, opts: { v: string; t: string }[], cur: string, blank = "") => `<label class="field" for="${id}">${esc(label)}</label><select id="${id}" data-k="${id}">${blank ? `<option value="">${esc(blank)}</option>` : ""}${opts.map((o) => `<option value="${esc(o.v)}"${o.v === cur ? " selected" : ""}>${esc(o.t)}</option>`).join("")}</select>`;

function nav() {
  const st = S.cat?.staff; if (!st) return "";
  return `<header class="site"><span class="brand">Staff console</span><nav aria-label="Staff"><button type="button" data-act="goSchedule">Schedule</button>${can() ? btn("goBook", "Book for a patient") : ""}${btn("goTime", "Time off & closures")}<span class="who">${esc(st.name)} · ${esc(st.role.replace("_", " "))}</span><button type="button" data-act="logout">Log out</button></nav></header>`;
}

function rowHtml(r: Row): string {
  const time = `${fmtTime(r.startsAt, r.timeZone)}`;
  const open = S.open === r.id;
  const flags = [r.modality === "telehealth" ? "Video" : "", r.lateCancel ? "Late cancel" : "", r.bookedBy === "staff" ? "Booked by staff" : "", r.referralRef ? `Referral ${r.referralRef}` : ""].filter(Boolean);
  const detail = open ? `<dl class="summary"><dt>Date of birth</dt><dd>${esc(r.patientDob ?? "—")}</dd><dt>Phone</dt><dd>${esc(r.phone ?? "—")}</dd><dt>Email</dt><dd>${esc(r.email ?? "—")}</dd><dt>Reason</dt><dd>${esc(r.reason ?? "—")}</dd>${r.interpreterLanguage ? `<dt>Interpreter</dt><dd>${esc(r.interpreterLanguage)}</dd>` : ""}${r.accommodations ? `<dt>Needs</dt><dd>${esc(r.accommodations)}</dd>` : ""}${r.joinUrl ? `<dt>Video link</dt><dd><a href="${esc(r.joinUrl)}" rel="noopener">Join</a></dd>` : ""}${r.copayCents ? `<dt>Copay</dt><dd>$${(r.copayCents / 100).toFixed(2)}</dd>` : ""}</dl>` : "";
  const live = r.status === "confirmed" || r.status === "arrived";
  const acts = [
    r.status === "confirmed" ? btn("status", "Check in", { data: `${r.id}|arrived` }) : "",
    live ? btn("status", "Complete", { data: `${r.id}|completed` }) : "",
    r.status === "confirmed" ? btn("status", "No-show", { data: `${r.id}|no_show` }) : "",
    can() && r.status === "confirmed" ? btn("moveStart", "Reschedule", { data: r.id }) + btn("cancelStart", "Cancel", { data: r.id }) : "",
  ].join("");
  const move = S.moveFor === r.id ? `<fieldset><legend>New time</legend>${S.moveSlots.length ? `<div class="slots">${S.moveSlots.slice(0, 18).map((s) => `<label class="choice"><input type="radio" name="moveslot" value="${esc(s.id)}"><span class="card"><span>${esc(new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: r.timeZone }).format(new Date(s.startsAt)))}, ${esc(fmtTime(s.startsAt, r.timeZone))}</span><span class="badge" aria-hidden="true">Selected</span></span></label>`).join("")}</div>` : `<p class="hint">No other times available.</p>`}</fieldset>` : "";
  const cancel = S.cancelFor === r.id ? `<div class="subform"><label class="field" for="creason">Reason for cancelling</label><input id="creason" data-k="creason" type="text" maxlength="120">${btn("cancelDo", "Confirm cancel", { primary: true, data: r.id })}</div>` : "";
  return `<li class="appt row-${esc(r.status)}"><div><strong>${esc(time)}</strong> · ${esc(r.patientName)} <span class="badge-s">${esc(r.status.replace("_", " "))}</span><br>${esc(r.visitLabel)} with ${esc(r.providerName)}${flags.length ? `<br><small>${esc(flags.join(" · "))}</small>` : ""}${detail}${move}${cancel}<div class="actions">${btn("toggle", open ? "Hide details" : "Details", { data: r.id })}${acts}${S.moveFor === r.id ? btn("moveDo", "Confirm new time", { primary: true, data: r.id }) : ""}</div></div></li>`;
}

function view(): string {
  const c = S.cat;
  switch (S.view) {
    case "loading": return `<div aria-hidden="true"><div class="skeleton"></div></div><p class="sr-only" role="status">Loading</p>`;
    case "login": return `<main><h1 tabindex="-1" id="h">Staff log in</h1>${bannerHtml(S.banner)}<form id="f" novalidate><label class="field" for="email">Email address</label><input id="email" data-k="email" type="email" autocomplete="username" value="${esc(S.email)}"><label class="field" for="password">Password</label><input id="password" data-k="password" type="password" autocomplete="current-password"><div class="actions"><button type="submit" class="primary"${S.busy ? " disabled" : ""}>${S.busy ? "Logging in…" : "Log in"}</button></div></form></main>`;
    case "schedule": {
      const provs = (S.clinicId ? clinic(S.clinicId)?.providers : c?.clinics.flatMap((x) => x.providers)) ?? [];
      const uniq = [...new Map(provs.map((p) => [p.id, p])).values()];
      return `${nav()}<main><h1 tabindex="-1" id="h">Schedule</h1>${bannerHtml(S.banner)}<div class="filters">${inp("date", "Date", "date")}${sel("clinicId", "Clinic", c!.clinics.map((x) => ({ v: x.id, t: x.name })), S.clinicId, "All clinics")}${role() === "provider" ? "" : sel("providerId", "Provider", uniq.map((p) => ({ v: p.id, t: p.displayName })), S.providerId, "All providers")}</div><div class="actions">${btn("load", "Show schedule", { primary: true })}</div>${S.rows.length === 0 ? `<p class="lead">No appointments for this day.</p>` : `<ul class="appts">${S.rows.map(rowHtml).join("")}</ul>`}${can() ? `<h2 class="h2-md">Export</h2><div class="filters">${inp("exportFrom", "From", "date")}${inp("exportTo", "To", "date")}</div><div class="actions"><a class="button" id="csv" href="${API}/export.csv?from=${esc(S.exportFrom)}&to=${esc(S.exportTo)}">Download CSV</a></div><p class="hint">Contains patient details. Handle according to your privacy policy.</p>` : ""}</main>`;
    }
    case "book": {
      const b = S.book; const cl = clinic(String(b.clinicId));
      const provs = cl?.providers.filter((p) => !b.serviceId || p.visitTypeIds.includes(String(b.serviceId))) ?? [];
      return `${nav()}<main><h1 tabindex="-1" id="h">Book for a patient</h1><p class="lead">For phone and walk-in patients who don't have an account.</p>${bannerHtml(S.banner)}<form id="f" novalidate>
        ${sel("clinicId", "Clinic", c!.clinics.map((x) => ({ v: x.id, t: x.name })), String(b.clinicId), "Select a clinic")}
        ${sel("serviceId", "Visit type", cl?.visitTypes.map((v) => ({ v: v.id, t: v.label })) ?? [], String(b.serviceId), "Select a visit type")}
        ${sel("providerId", "Provider", provs.map((p) => ({ v: p.id, t: p.displayName })), String(b.providerId), "Select a provider")}
        ${S.slots.length ? `<fieldset><legend>Time</legend><div class="slots">${S.slots.slice(0, 24).map((s) => `<label class="choice"><input type="radio" name="bslot" value="${esc(s.id)}"${s.id === b.slotId ? " checked" : ""}><span class="card"><span>${esc(new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: cl!.timeZone }).format(new Date(s.startsAt)))}, ${esc(fmtTime(s.startsAt, cl!.timeZone))}</span><span class="badge" aria-hidden="true">Selected</span></span></label>`).join("")}</div></fieldset>` : b.providerId ? `<p class="hint">No times available for this provider.</p>` : ""}
        <h2 class="h2-md">Patient</h2>${inp("firstName", "First name")}${inp("lastName", "Last name")}${inp("dob", "Date of birth", "date")}${inp("phone", "Phone", "tel")}${inp("email", "Email", "email")}
        <label class="check"><input type="checkbox" name="smsOk"${b.smsOk ? " checked" : ""}> <span>Patient agreed to text reminders</span></label>
        <label class="field" for="reason">Reason for visit</label><textarea id="reason" data-k="reason" rows="2" maxlength="500">${esc(String(b.reason))}</textarea>
        ${sel("modality", "Format", [{ v: "in_person", t: "In person" }, { v: "telehealth", t: "Video" }], String(b.modality))}${b.modality === "telehealth" ? inp("patientState", "Patient's state (2 letters)", "text", 'maxlength="2"') : ""}
        <fieldset><legend>Attestations</legend><label class="check"><input type="checkbox" name="screenOk"${b.screenOk ? " checked" : ""}> <span>I read the emergency screening questions to the patient and they answered no to all</span></label><label class="check"><input type="checkbox" name="consent"${b.consent ? " checked" : ""}> <span>The patient gave verbal consent to treatment</span></label></fieldset>
        <div class="actions"><button type="submit" class="primary"${S.busy ? " disabled" : ""}>${S.busy ? "Booking…" : "Book appointment"}</button></div></form></main>`;
    }
    case "time": {
      const allProv = [...new Map((c?.clinics.flatMap((x) => x.providers) ?? []).map((p) => [p.id, p])).values()];
      return `${nav()}<main><h1 tabindex="-1" id="h">Time off &amp; closures</h1>${bannerHtml(S.banner)}
        <h2 class="h2-md">Provider time off</h2>${sel("providerId", "Provider", allProv.map((p) => ({ v: p.id, t: p.displayName })), S.tof.providerId || (role() === "provider" ? S.cat!.staff.providerId ?? "" : ""), "Select a provider")}
        ${S.timeOff.length ? `<ul class="appts">${S.timeOff.map((t) => `<li class="appt"><div>${esc(new Date(t.startsAt).toLocaleString())} to ${esc(new Date(t.endsAt).toLocaleString())}</div>${can() ? btn("rmOff", "Remove", { data: String(t.id) }) : ""}</li>`).join("")}</ul>` : ""}
        <p class="hint">Enter times in the clinic's local time (the first clinic's zone is used).</p>${inp("start", "Starts", "datetime-local")}${inp("end", "Ends", "datetime-local")}<div class="actions">${btn("addOff", "Add time off", { primary: true })}</div>
        ${can() ? `<h2 class="h2-md">Clinic closures</h2>${S.closures.length ? `<ul class="appts">${S.closures.map((t) => `<li class="appt"><div>${esc(new Date(t.startsAt).toLocaleString())} to ${esc(new Date(t.endsAt).toLocaleString())}<br><small>${esc(t.reason)}</small></div>${btn("rmClosure", "Remove", { data: String(t.id) })}</li>`).join("")}</ul>` : `<p class="hint">No upcoming closures.</p>`}
        ${sel("clinicId", "Clinic", c!.clinics.map((x) => ({ v: x.id, t: x.name })), S.clinicId, "Select a clinic")}${inp("cStart", "Closed from", "datetime-local")}${inp("cEnd", "Closed until", "datetime-local")}${inp("cReason", "Reason")}<div class="actions">${btn("addClosure", "Add closure", { primary: true })}</div><p class="hint">Existing appointments in the window are not cancelled; you'll be told how many to move.</p>` : ""}</main>`;
    }
  }
}

function render(focus = true) {
  root.setAttribute("aria-busy", S.view === "loading" ? "true" : "false");
  root.innerHTML = view(); document.title = "Staff console";
  if (focus) (document.getElementById("h") as HTMLElement | null)?.focus();
}
const fail = (r: { status: number; body: any }, fb: string) => { S.banner = { kind: "error", text: errText(r, fb) }; };

async function loadSchedule() {
  const q = new URLSearchParams({ date: S.date, ...(S.clinicId ? { clinicId: S.clinicId } : {}), ...(S.providerId ? { providerId: S.providerId } : {}) });
  const r = await call<{ appointments: Row[] }>("GET", `/schedule?${q}`);
  if (r.status === 200) { S.rows = r.body.appointments; } else fail(r, "We couldn't load the schedule.");
}
async function boot() {
  const r = await call<Cat>("GET", "/catalog");
  if (r.status !== 200) { S.view = "login"; return render(); }
  S.cat = r.body; const tz = S.cat.clinics[0]?.timeZone ?? "UTC"; S.date = ymd(new Date(), tz); S.exportFrom = S.date; S.exportTo = S.date;
  S.view = "schedule"; await loadSchedule(); render();
}
async function loadBookSlots() {
  const b = S.book; S.slots = [];
  if (b.clinicId && b.serviceId && b.providerId) { const q = new URLSearchParams({ clinicId: String(b.clinicId), serviceId: String(b.serviceId), providerId: String(b.providerId) }); const r = await call<{ slots: Slot[] }>("GET", `/slots?${q}`); if (r.status === 200) S.slots = r.body.slots; }
}
async function loadTime() {
  S.timeOff = []; S.closures = [];
  if (S.tof.providerId) { const r = await call<{ timeOff: any[] }>("GET", `/providers/${encodeURIComponent(S.tof.providerId)}/time-off`); if (r.status === 200) S.timeOff = r.body.timeOff; }
  if (can() && S.clinicId) { const r = await call<{ closures: any[] }>("GET", `/clinics/${encodeURIComponent(S.clinicId)}/closures`); if (r.status === 200) S.closures = r.body.closures; }
}
const tzOf = () => clinic(S.clinicId)?.timeZone ?? S.cat?.clinics[0]?.timeZone ?? "UTC";

async function act(a: string, id = "") {
  if (S.busy) return;
  S.banner = undefined;
  try {
    switch (a) {
      case "goSchedule": S.view = "schedule"; await loadSchedule(); return render();
      case "goBook": S.view = "book"; S.slots = []; return render();
      case "goTime": S.view = "time"; if (role() === "provider") S.tof.providerId = S.cat!.staff.providerId ?? ""; await loadTime(); return render();
      case "load": await loadSchedule(); return render(false);
      case "toggle": S.open = S.open === id ? "" : id; return render(false);
      case "status": { const [i, st] = id.split("|"); const r = await call("POST", `/appointments/${encodeURIComponent(i!)}/status`, { status: st }); if (r.status !== 200) fail(r, "That change isn't allowed."); else S.banner = { kind: "success", text: "Updated." }; await loadSchedule(); return render(false); }
      case "cancelStart": S.cancelFor = S.cancelFor === id ? "" : id; S.moveFor = ""; return render(false);
      case "cancelDo": { const reason = (document.getElementById("creason") as HTMLInputElement | null)?.value ?? ""; const r = await call("POST", `/appointments/${encodeURIComponent(id)}/cancel`, { reason }); if (r.status !== 200) fail(r, "We couldn't cancel that."); else { S.banner = { kind: "success", text: "Cancelled. The patient will be notified." }; S.cancelFor = ""; } await loadSchedule(); return render(false); }
      case "moveStart": {
        const row = S.rows.find((x) => x.id === id)!; const cl = S.cat!.clinics.find((x) => x.name === row.clinicName); const sv = cl?.visitTypes.find((v) => v.label === row.visitLabel);
        S.moveFor = id; S.cancelFor = ""; S.moveSlots = [];
        if (cl && sv) { const q = new URLSearchParams({ clinicId: cl.id, serviceId: sv.id, providerId: row.providerId }); const r = await call<{ slots: Slot[] }>("GET", `/slots?${q}`); if (r.status === 200) S.moveSlots = r.body.slots; }
        return render(false);
      }
      case "moveDo": { const slotId = (document.querySelector('input[name="moveslot"]:checked') as HTMLInputElement | null)?.value; if (!slotId) { S.banner = { kind: "error", text: "Choose a new time." }; return render(false); } const r = await call("POST", `/appointments/${encodeURIComponent(id)}/reschedule`, { slotId }); if (r.status !== 200) fail(r, "We couldn't move that."); else { S.banner = { kind: "success", text: "Rescheduled. The patient will be notified." }; S.moveFor = ""; } await loadSchedule(); return render(false); }
      case "addOff": { const p = S.tof.providerId; if (!p || !S.tof.start || !S.tof.end) { S.banner = { kind: "error", text: "Choose a provider, start and end." }; return render(false); } const tz = S.cat!.clinics[0]?.timeZone ?? "UTC"; const r = await call("POST", `/providers/${encodeURIComponent(p)}/time-off`, { startsAt: zonedIso(S.tof.start, tz), endsAt: zonedIso(S.tof.end, tz) }); if (r.status !== 201) fail(r, "We couldn't add that."); else S.banner = { kind: "success", text: "Time off added." }; await loadTime(); return render(false); }
      case "rmOff": { await call("DELETE", `/time-off/${encodeURIComponent(id)}`); await loadTime(); return render(false); }
      case "addClosure": { if (!S.clinicId || !S.tof.cStart || !S.tof.cEnd) { S.banner = { kind: "error", text: "Choose a clinic, start and end." }; return render(false); } const r = await call<{ affectedAppointments?: number }>("POST", `/clinics/${encodeURIComponent(S.clinicId)}/closures`, { startsAt: zonedIso(S.tof.cStart, tzOf()), endsAt: zonedIso(S.tof.cEnd, tzOf()), reason: S.tof.cReason }); if (r.status !== 201) fail(r, "We couldn't add that."); else S.banner = { kind: (r.body.affectedAppointments ?? 0) > 0 ? "warning" : "success", text: (r.body.affectedAppointments ?? 0) > 0 ? `Closure added. ${r.body.affectedAppointments} existing appointment(s) fall in this window and need to be moved or cancelled.` : "Closure added." }; await loadTime(); return render(false); }
      case "rmClosure": { await call("DELETE", `/closures/${encodeURIComponent(id)}`); await loadTime(); return render(false); }
      case "logout": await call("POST", "/logout", {}); S.cat = undefined; S.view = "login"; S.rows = []; return render();
    }
  } catch { S.banner = { kind: "error", text: "We couldn't reach the server. Nothing was changed." }; render(false); }
}

async function submit() {
  if (S.busy) return; S.banner = undefined;
  try {
    if (S.view === "login") {
      S.busy = true; render(false); const r = await call<{ staff: Staff }>("POST", "/login", { email: S.email.trim(), password: S.password }); S.busy = false; S.password = "";
      if (r.status === 200) return boot();
      S.banner = { kind: "error", text: r.status === 423 ? "This account is locked for a few minutes after too many attempts." : r.status === 429 ? "Too many attempts. Please wait a minute." : "Invalid email or password." }; return render();
    }
    if (S.view === "book") {
      const b = S.book;
      if (!b.slotId || !b.firstName || !b.lastName) { S.banner = { kind: "error", text: "Choose a time and enter the patient's name." }; return render(false); }
      if (!b.screenOk || !b.consent) { S.banner = { kind: "error", text: "Confirm both attestations before booking." }; return render(false); }
      S.busy = true; render(false);
      const body = { clinicId: b.clinicId, serviceId: b.serviceId, providerId: b.providerId, slotId: b.slotId, patient: { firstName: b.firstName, lastName: b.lastName, dateOfBirth: b.dob || undefined, phone: b.phone || undefined, email: b.email || undefined }, reason: b.reason, redFlags: [], modality: b.modality, patientState: b.patientState || undefined, consentAttested: true, smsOk: b.smsOk };
      const r = await call<{ appointment: Row }>("POST", "/appointments", body); S.busy = false;
      if (r.status === 201) { S.banner = { kind: "success", text: `Booked ${r.body.appointment.patientName} for ${fmtTime(r.body.appointment.startsAt, r.body.appointment.timeZone)}.` }; Object.assign(S.book, { slotId: "", firstName: "", lastName: "", dob: "", phone: "", email: "", reason: "", screenOk: false, consent: false, smsOk: false }); await loadBookSlots(); return render(); }
      fail(r, "We couldn't book that."); return render(false);
    }
  } catch { S.busy = false; S.banner = { kind: "error", text: "We couldn't reach the server. Nothing was changed." }; render(false); }
}

root.addEventListener("click", (e) => { const t = (e.target as HTMLElement).closest("button[data-act]") as HTMLElement | null; if (t && !(t as HTMLButtonElement).disabled) void act(t.dataset.act!, t.dataset.id ?? ""); });
root.addEventListener("submit", (e) => { e.preventDefault(); void submit(); });
root.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement; const k = t.dataset?.k; if (!k) return;
  if (k in S.book) S.book[k] = t.value; else if (k in S.tof) S.tof[k] = t.value; else if (k === "email" || k === "password" || k === "exportFrom" || k === "exportTo" || k === "date") { (S as any)[k] = t.value; if (k.startsWith("export")) { const a = document.getElementById("csv") as HTMLAnchorElement | null; if (a) a.href = `${API}/export.csv?from=${S.exportFrom}&to=${S.exportTo}`; } }
});
root.addEventListener("change", async (e) => {
  const t = e.target as HTMLInputElement; const k = t.dataset?.k;
  if (t.name === "smsOk" || t.name === "screenOk" || t.name === "consent") { S.book[t.name] = t.checked; return; }
  if (t.name === "bslot") { S.book.slotId = t.value; return; }
  if (!k) return;
  if (S.view === "book") {
    S.book[k] = t.value;
    if (k === "clinicId") { S.book.serviceId = ""; S.book.providerId = ""; S.book.slotId = ""; S.slots = []; render(false); }
    else if (k === "serviceId") { S.book.providerId = ""; S.book.slotId = ""; S.slots = []; render(false); }
    else if (k === "providerId") { S.book.slotId = ""; await loadBookSlots(); render(false); }
    else if (k === "modality") render(false);
    document.getElementById(k)?.focus();
  } else if (S.view === "schedule") {
    if (k === "clinicId") { S.clinicId = t.value; S.providerId = ""; render(false); document.getElementById(k)?.focus(); } else if (k === "providerId") S.providerId = t.value; else if (k === "date") S.date = t.value;
  } else if (S.view === "time") {
    if (k === "providerId") { S.tof.providerId = t.value; await loadTime(); render(false); document.getElementById(k)?.focus(); }
    else if (k === "clinicId") { S.clinicId = t.value; await loadTime(); render(false); document.getElementById(k)?.focus(); }
  }
});
void boot();
