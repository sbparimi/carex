// "My appointments" page: the signed-in account's own appointments; view, cancel, or move one (ADR-005).
import { safeBrand } from "./theme.js";
import { bannerHtml, esc, fmtDay, fmtTime, fetchMe, headerHtml, logout, radiosHtml, tenantSlug, toLogin, type Banner, type Me } from "./common.js";
import type { BrandConfig, ManagedAppointment, RescheduleOutcome, Slot } from "@carex/contracts";

interface WaitEntry { id: number; clinicName: string; visitLabel: string; providerName: string | null }
type View = "loading" | "list" | "notfound" | "details" | "confirmCancel" | "pickTime" | "confirmTime";
const root = document.getElementById("app")!;
const slug = /^\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? "";
const API = `/t/${slug}/api`;
let ref = "";

const M = { view: "loading" as View, me: undefined as Me | undefined, list: [] as ManagedAppointment[], appt: undefined as ManagedAppointment | undefined, brand: undefined as BrandConfig | undefined, banner: undefined as Banner, slots: [] as Slot[], waitlist: [] as WaitEntry[], reason: "", slotId: "", daysShown: 3, busy: false };

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const headers: Record<string, string> = { ...(init.method === "POST" ? { "content-type": "application/json" } : {}) };
    const r = await fetch(API + path, { ...init, headers, ...(init.method === "POST" && !init.body ? { body: "{}" } : {}), signal: ctl.signal });
    if (r.status === 401) { toLogin(); return new Promise(() => {}); }
    return { status: r.status, body: await r.json() as T };
  } finally { clearTimeout(timer); }
}

const zone = () => M.appt?.summary.timeZone ?? "UTC";
const hours = (min: number) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);
const actions = (...btns: string[]) => `<div class="actions">${btns.join("")}</div>`;
const btn = (act: string, label: string, opts: { primary?: boolean; disabled?: boolean } = {}) => `<button type="button"${opts.primary ? ' class="primary"' : ""} data-act="${act}"${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;

function summary(a: ManagedAppointment) {
  const s = a.summary;
  return `<dl class="summary"><dt>Reference</dt><dd>${esc(a.bookingId)}</dd><dt>Clinic</dt><dd>${esc(s.clinic.name)}<br>${esc(s.clinic.address)}</dd><dt>Visit type</dt><dd>${esc(s.visitType.label)}</dd><dt>Provider</dt><dd>${esc(s.provider.displayName)}</dd><dt>Date</dt><dd>${esc(fmtDay(s.startsAt, s.timeZone))}</dd><dt>Time</dt><dd>${esc(fmtTime(s.startsAt, s.timeZone))}</dd>${s.patientName ? `<dt>Patient</dt><dd>${esc(s.patientName)}</dd>` : ""}${s.reason ? `<dt>Reason</dt><dd>${esc(s.reason)}</dd>` : ""}${s.modality === "telehealth" ? `<dt>Format</dt><dd>Video visit${s.joinUrl ? ` — <a href="${esc(s.joinUrl)}" rel="noopener">Join link</a>` : ""}</dd>` : ""}${s.copayCents ? `<dt>Expected copay</dt><dd>$${(s.copayCents / 100).toFixed(2)}, due at the visit</dd>` : ""}</dl>`;
}
function prefsHtml() {
  const n = M.me?.notify ?? { email: true, sms: false };
  return `<h2 class="h2-md">Reminders</h2><fieldset><legend class="sr-only">How should we remind you?</legend><label class="check"><input type="checkbox" name="pref-email"${n.email ? " checked" : ""}> <span>Email me confirmations and reminders</span></label><label class="check"><input type="checkbox" name="pref-sms"${n.sms ? " checked" : ""}> <span>Text me reminders (message and data rates may apply)</span></label></fieldset>${M.banner?.text === "Reminder settings saved." ? "" : ""}`;
}
function waitHtml() {
  if (!M.waitlist.length) return "";
  return `<h2 class="h2-md">Waitlist</h2><ul class="appts">${M.waitlist.map((w) => `<li class="appt"><div><strong>${esc(w.visitLabel)}</strong>${w.providerName ? ` with ${esc(w.providerName)}` : ""}<br><small>${esc(w.clinicName)} · We'll email you if an earlier time opens</small></div><button type="button" data-act="leaveWait" data-ref="${w.id}" aria-label="Leave waitlist for ${esc(w.visitLabel)}">Leave</button></li>`).join("")}</ul>`;
}
function support() {
  const b = M.brand; const bits = [b?.supportPhone, b?.supportEmail].filter(Boolean).map((x) => esc(x));
  return bits.length ? ` Please contact the clinic: ${bits.join(" or ")}.` : " Please contact the clinic.";
}

function view(): string {
  const a = M.appt;
  switch (M.view) {
    case "loading": return `<div aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div><p class="sr-only" role="status">Loading</p>`;
    case "list": {
      const nowMs = Date.now();
      const upcoming = M.list.filter((x) => x.status === "confirmed" && Date.parse(x.summary.endsAt) >= nowMs);
      const earlier = M.list.filter((x) => !upcoming.includes(x)).reverse();
      const card = (x: ManagedAppointment) => `<li class="appt"><div><strong>${esc(x.summary.visitType.label)}</strong> with ${esc(x.summary.provider.displayName)}<br>${esc(fmtDay(x.summary.startsAt, x.summary.timeZone))}, ${esc(fmtTime(x.summary.startsAt, x.summary.timeZone))}<br><small>${esc(x.summary.clinic.name)} · ${esc(x.bookingId)}${x.status === "cancelled" ? " · Cancelled" : ""}</small></div><button type="button" data-act="open" data-ref="${esc(x.bookingId)}" aria-label="View ${esc(x.summary.visitType.label)} on ${esc(fmtDay(x.summary.startsAt, x.summary.timeZone))}">View</button></li>`;
      const group = (title: string, items: ManagedAppointment[]) => items.length ? `<h2 class="h2-md">${title}</h2><ul class="appts">${items.map(card).join("")}</ul>` : "";
      return `<h1 tabindex="-1" id="h">My appointments</h1>${bannerHtml(M.banner)}${M.list.length === 0 ? `<p class="lead">You have no appointments yet.</p>` : group("Upcoming", upcoming) + group("Earlier and cancelled", earlier)}${prefsHtml()}${waitHtml()}${actions(btn("home", "Book an appointment", { primary: true }))}`;
    }
    case "notfound": return `<h1 tabindex="-1" id="h">We couldn't find this appointment</h1><div class="banner warning" role="status"><span class="icon" aria-hidden="true">!</span><span class="text">It may have been removed.${support()}</span></div>${actions(btn("list", "My appointments", { primary: true }))}`;
    case "details": {
      if (!a) return "";
      if (a.status === "cancelled") return `<h1 tabindex="-1" id="h">Appointment cancelled</h1>${bannerHtml(M.banner ?? { kind: "info", text: "This appointment has been cancelled. The time has been released." })}${summary(a)}${actions(btn("list", "My appointments"), btn("home", "Book a new appointment", { primary: true }))}`;
      const note = a.canChange ? "" : `<p class="hint">Appointments can be changed online up to ${hours(a.changeNoticeMinutes)} before they start.${support()}</p>`;
      return `<h1 tabindex="-1" id="h">Your appointment</h1>${bannerHtml(M.banner)}${summary(a)}${note}${actions(btn("list", "Back to my appointments"), ...(a.canChange ? [btn("pick", "Change time"), btn("cancel", "Cancel appointment")] : []))}`;
    }
    case "confirmCancel": return a ? `<h1 tabindex="-1" id="h">Cancel this appointment?</h1>${bannerHtml(M.banner)}${summary(a)}<label class="field" for="cancel-reason">Reason (optional)</label><select id="cancel-reason"><option value="">Prefer not to say</option><option value="schedule_conflict">Schedule conflict</option><option value="feeling_better">Feeling better</option><option value="found_other_care">Found other care</option><option value="cost">Cost</option><option value="other">Other</option></select><p class="hint">The time will be released for other patients. You can book a new appointment afterwards.</p>${actions(btn("keep", "Keep appointment"), btn("doCancel", M.busy ? "Cancelling…" : "Yes, cancel appointment", { primary: true, disabled: M.busy }))}` : "";
    case "pickTime": {
      if (!a) return "";
      const byDay = new Map<string, Slot[]>(); for (const s of M.slots) { const d = fmtDay(s.startsAt, zone()); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
      const chosen = [...byDay.values()].findIndex((ss) => ss.some((x) => x.id === M.slotId));
      const shown = Math.max(M.daysShown, chosen + 1);
      const days = [...byDay].slice(0, shown).map(([d, ss]) => `<fieldset><legend>${esc(d)}</legend><div class="slots">${radiosHtml("slot", ss.map((s) => ({ id: s.id, title: fmtTime(s.startsAt, zone()) })), M.slotId)}</div></fieldset>`).join("");
      return `<h1 tabindex="-1" id="h">Choose a new time</h1>${bannerHtml(M.banner)}<p class="lead">${esc(a.summary.visitType.label)} with ${esc(a.summary.provider.displayName)}</p>${M.slots.length === 0 ? `<div class="banner info" role="status"><span class="icon" aria-hidden="true">i</span><span class="text">No other times are currently available.${support()}</span></div>` : `<p class="hint">Times are shown in ${esc(zone())}. Your current appointment stays booked until you confirm.</p>${days}${byDay.size > shown ? actions(btn("moreDays", "Show more dates")) : ""}`}${actions(btn("keep", "Back"), btn("review", "Continue", { primary: true, disabled: !M.slotId }))}`;
    }
    case "confirmTime": {
      const s = M.slots.find((x) => x.id === M.slotId); if (!a || !s) return "";
      return `<h1 tabindex="-1" id="h">Confirm the new time</h1>${bannerHtml(M.banner)}<dl class="summary"><dt>Now</dt><dd>${esc(fmtDay(a.summary.startsAt, zone()))}, ${esc(fmtTime(a.summary.startsAt, zone()))}</dd><dt>New</dt><dd>${esc(fmtDay(s.startsAt, zone()))}, ${esc(fmtTime(s.startsAt, zone()))}</dd></dl>${actions(btn("pick", "Back"), btn("doMove", M.busy ? "Changing…" : "Confirm new time", { primary: true, disabled: M.busy }))}`;
    }
  }
}

function render(focus = true) {
  root.setAttribute("aria-busy", M.view === "loading" ? "true" : "false");
  root.innerHTML = `${headerHtml(M.brand?.displayName ?? "", M.me, "appointments")}<main>${view()}</main>`;
  document.title = `${M.brand?.displayName ? M.brand.displayName + " – " : ""}My appointments`;
  if (focus) (document.getElementById("h") as HTMLElement | null)?.focus();
}

/** Maps a failed response to a banner (and the not-found view). Returns true when it handled the response. */
function handleError(status: number, body: unknown): boolean {
  const code = (body as { error?: { code?: string; message?: string } })?.error?.code;
  if (status === 404) { M.view = "notfound"; M.banner = undefined; render(); return true; }
  if (status === 429) { M.banner = { kind: "error", text: "Too many attempts. Please wait a minute and try again." }; render(false); return true; }
  if (status === 409 && code === "change_window_closed") { M.banner = { kind: "warning", text: (body as { error: { message: string } }).error.message }; return false; }
  if (status >= 500) { M.banner = { kind: "error", text: "Scheduling is temporarily unavailable. Nothing was changed. Please try again shortly." }; render(false); return true; }
  return false;
}
async function reloadWait() { const r = await call<{ entries: WaitEntry[] }>("/waitlist"); M.waitlist = r.status === 200 ? r.body.entries : []; }
async function reloadList() { const r = await call<{ appointments: ManagedAppointment[] }>("/bookings"); if (r.status === 200) M.list = r.body.appointments; }
async function reloadAppointment() { const r = await call<ManagedAppointment>(`/bookings/${encodeURIComponent(ref)}`); if (r.status === 200) M.appt = r.body; return r; }
async function loadSlots() {
  const a = M.appt!.summary; const q = new URLSearchParams({ clinicId: a.clinic.id, serviceId: a.visitType.id, providerId: a.provider.id });
  const r = await fetch(`${API}/slots?${q}`); if (r.status === 401) { toLogin(); return; }
  M.slots = ((await r.json()) as { slots: Slot[] }).slots.filter((s) => s.startsAt !== a.startsAt);
  if (M.slotId && !M.slots.some((s) => s.id === M.slotId)) M.slotId = "";
}

async function act(name: string, open = "") {
  if (M.busy) return;
  try {
    switch (name) {
      case "leaveWait": { await call(`/waitlist/${encodeURIComponent(open)}/leave`, { method: "POST" }); await reloadWait(); return render(false); }
      case "home": location.assign(`/t/${slug}/`); return;
      case "keep": M.view = "details"; M.banner = undefined; return render();
      case "list": { M.view = "list"; M.banner = undefined; await reloadList(); await reloadWait(); return render(); }
      case "open": { ref = open; const r = await reloadAppointment(); if (r.status !== 200) { M.view = "notfound"; return render(); } M.view = "details"; M.banner = undefined; return render(); }
      case "cancel": M.view = "confirmCancel"; M.banner = undefined; return render();
      case "doCancel": {
        M.busy = true; render(false);
        const r = await call<ManagedAppointment>(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST", body: JSON.stringify({ reason: M.reason || undefined }) }); M.busy = false;
        if (r.status === 200) { M.appt = r.body; M.view = "details"; M.banner = { kind: "success", text: "Your appointment has been cancelled." }; return render(); }
        if (handleError(r.status, r.body)) return;
        await reloadAppointment(); M.view = "details"; return render();
      }
      case "pick": { M.view = "pickTime"; M.banner = undefined; M.daysShown = 3; await loadSlots(); return render(); }
      case "moreDays": { M.daysShown += 3; render(false); return; }
      case "review": if (M.slotId) { M.view = "confirmTime"; M.banner = undefined; return render(); } return;
      case "doMove": {
        M.busy = true; render(false);
        const r = await call<RescheduleOutcome | { error: unknown }>(`/bookings/${encodeURIComponent(ref)}/reschedule`, { method: "POST", body: JSON.stringify({ slotId: M.slotId }) }); M.busy = false;
        const body = r.body as RescheduleOutcome;
        if (r.status === 200 && body.status === "rescheduled") { M.appt = body.appointment; M.view = "details"; M.slotId = ""; M.banner = { kind: "success", text: "Your appointment time has been changed." }; return render(); }
        if (r.status === 409 && body.status === "slot_unavailable") { M.view = "pickTime"; M.slotId = ""; await loadSlots(); M.banner = { kind: "warning", text: body.message }; return render(); }
        if (handleError(r.status, r.body)) return;
        await reloadAppointment(); M.view = "details"; return render();
      }
    }
  } catch { M.busy = false; M.banner = { kind: "error", text: "We couldn't reach the server. Nothing was changed. Please check your connection and try again." }; render(false); }
}

root.addEventListener("click", (ev) => { const t = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null; if (t) { if (t.dataset.act === "logout") void logout(); else void act(t.dataset.act!, t.dataset.ref ?? ""); } });
root.addEventListener("change", (ev) => { const t = ev.target as HTMLInputElement;
  if (t.id === "cancel-reason") { M.reason = t.value; return; }
  if (t.name === "pref-email" || t.name === "pref-sms") {
    const key = t.name === "pref-email" ? "email" : "sms";
    void call<{ notify?: { email: boolean; sms: boolean } }>("/notifications", { method: "POST", body: JSON.stringify({ [key]: t.checked }) }).then((r) => { if (r.status === 200 && r.body.notify && M.me) M.me.notify = r.body.notify; });
    return;
  } if (t.name === "slot") { M.slotId = t.value; render(false); (document.querySelector(`input[name="slot"][value="${CSS.escape(t.value)}"]`) as HTMLElement | null)?.focus(); } });

(async function boot() {
  render();
  try {
    const cfg = await fetch(`${API}/config`);
    if (cfg.status === 200) { M.brand = ((await cfg.json()) as { brand: BrandConfig }).brand; document.documentElement.style.setProperty("--brand", safeBrand(M.brand.primaryColor)); }
    const me = await fetchMe(); if (!me) { toLogin(); return; }
    M.me = me; await reloadList(); await reloadWait();
    const want = new URLSearchParams(location.search).get("ref");
    if (want && M.list.some((x) => x.bookingId === want)) { ref = want; await reloadAppointment(); M.view = "details"; } else M.view = "list";
    render();
  } catch { M.view = "notfound"; render(); }
})();
