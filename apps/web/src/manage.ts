// "Manage your appointment" page: view, cancel, or move a booking using the private link from the confirmation screen.
// The token lives in the URL fragment (never sent to a server or in a Referer) and travels only in a request header.
import { safeBrand } from "./theme.js";
import { bannerHtml, esc, fmtDay, fmtTime, radiosHtml, type Banner } from "./common.js";
import type { BrandConfig, ManagedAppointment, RescheduleOutcome, Slot } from "@carex/contracts";

type View = "loading" | "missing" | "notfound" | "details" | "confirmCancel" | "pickTime" | "confirmTime";
const root = document.getElementById("app")!;
const slug = /^\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? "";
const API = `/t/${slug}/api`;
const frag = new URLSearchParams(location.hash.replace(/^#/, ""));
const ref = frag.get("ref") ?? ""; const token = frag.get("token") ?? "";

const M = { view: "loading" as View, appt: undefined as ManagedAppointment | undefined, brand: undefined as BrandConfig | undefined, banner: undefined as Banner, slots: [] as Slot[], slotId: "", daysShown: 3, busy: false };

async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12_000);
  try {
    const headers: Record<string, string> = { "x-manage-token": token, ...(init.body ? { "content-type": "application/json" } : {}) };
    const r = await fetch(API + path, { ...init, headers, signal: ctl.signal });
    return { status: r.status, body: await r.json() as T };
  } finally { clearTimeout(timer); }
}

const zone = () => M.appt?.summary.timeZone ?? "UTC";
const hours = (min: number) => (min % 60 === 0 ? `${min / 60} hour${min === 60 ? "" : "s"}` : `${min} minutes`);
const actions = (...btns: string[]) => `<div class="actions">${btns.join("")}</div>`;
const btn = (act: string, label: string, opts: { primary?: boolean; disabled?: boolean } = {}) => `<button type="button"${opts.primary ? ' class="primary"' : ""} data-act="${act}"${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;

function summary(a: ManagedAppointment) {
  const s = a.summary;
  return `<dl class="summary"><dt>Reference</dt><dd>${esc(a.bookingId)}</dd><dt>Clinic</dt><dd>${esc(s.clinic.name)}<br>${esc(s.clinic.address)}</dd><dt>Visit type</dt><dd>${esc(s.visitType.label)}</dd><dt>Provider</dt><dd>${esc(s.provider.displayName)}</dd><dt>Date</dt><dd>${esc(fmtDay(s.startsAt, s.timeZone))}</dd><dt>Time</dt><dd>${esc(fmtTime(s.startsAt, s.timeZone))}</dd></dl>`;
}
function support() {
  const b = M.brand; const bits = [b?.supportPhone, b?.supportEmail].filter(Boolean).map((x) => esc(x));
  return bits.length ? ` Please contact the clinic: ${bits.join(" or ")}.` : " Please contact the clinic.";
}

function view(): string {
  const a = M.appt;
  switch (M.view) {
    case "loading": return `<div aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div><p class="sr-only" role="status">Loading</p>`;
    case "missing": return `<h1 tabindex="-1" id="h">This link is incomplete</h1><div class="banner warning" role="status"><span class="icon" aria-hidden="true">!</span><span class="text">Open the full link from your confirmation screen.${support()}</span></div>`;
    case "notfound": return `<h1 tabindex="-1" id="h">We couldn't find this appointment</h1><div class="banner warning" role="status"><span class="icon" aria-hidden="true">!</span><span class="text">The link may be incomplete or no longer valid.${support()}</span></div>${actions(btn("home", "Book a new appointment"))}`;
    case "details": {
      if (!a) return "";
      if (a.status === "cancelled") return `<h1 tabindex="-1" id="h">Appointment cancelled</h1>${bannerHtml(M.banner ?? { kind: "info", text: "This appointment has been cancelled. The time has been released." })}${summary(a)}${actions(btn("home", "Book a new appointment", { primary: true }))}`;
      const note = a.canChange ? "" : `<p class="hint">Appointments can be changed online up to ${hours(a.changeNoticeMinutes)} before they start.${support()}</p>`;
      return `<h1 tabindex="-1" id="h">Your appointment</h1>${bannerHtml(M.banner)}${summary(a)}${note}${a.canChange ? actions(btn("pick", "Change time"), btn("cancel", "Cancel appointment")) : ""}`;
    }
    case "confirmCancel": return a ? `<h1 tabindex="-1" id="h">Cancel this appointment?</h1>${bannerHtml(M.banner)}${summary(a)}<p class="hint">The time will be released for other patients. You can book a new appointment afterwards.</p>${actions(btn("keep", "Keep appointment"), btn("doCancel", M.busy ? "Cancelling…" : "Yes, cancel appointment", { primary: true, disabled: M.busy }))}` : "";
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
  root.innerHTML = `<header class="site"><div class="brand">${esc(M.brand?.displayName ?? "")}</div></header><main>${view()}</main>`;
  document.title = `${M.brand?.displayName ? M.brand.displayName + " – " : ""}Manage your appointment`;
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
async function reloadAppointment() { const r = await call<ManagedAppointment>(`/bookings/${encodeURIComponent(ref)}`); if (r.status === 200) M.appt = r.body; return r; }
async function loadSlots() {
  const a = M.appt!.summary; const q = new URLSearchParams({ clinicId: a.clinic.id, serviceId: a.visitType.id, providerId: a.provider.id });
  const r = await fetch(`${API}/slots?${q}`); M.slots = ((await r.json()) as { slots: Slot[] }).slots.filter((s) => s.startsAt !== a.startsAt);
  if (M.slotId && !M.slots.some((s) => s.id === M.slotId)) M.slotId = "";
}

async function act(name: string) {
  if (M.busy) return;
  try {
    switch (name) {
      case "home": location.assign(`/t/${slug}/`); return;
      case "keep": M.view = "details"; M.banner = undefined; return render();
      case "cancel": M.view = "confirmCancel"; M.banner = undefined; return render();
      case "doCancel": {
        M.busy = true; render(false);
        const r = await call<ManagedAppointment>(`/bookings/${encodeURIComponent(ref)}/cancel`, { method: "POST" }); M.busy = false;
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

root.addEventListener("click", (ev) => { const t = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null; if (t) void act(t.dataset.act!); });
root.addEventListener("change", (ev) => { const t = ev.target as HTMLInputElement; if (t.name === "slot") { M.slotId = t.value; render(false); (document.querySelector(`input[name="slot"][value="${CSS.escape(t.value)}"]`) as HTMLElement | null)?.focus(); } });

(async function boot() {
  render();
  try {
    const cfg = await fetch(`${API}/config`);
    if (cfg.status === 200) { M.brand = ((await cfg.json()) as { brand: BrandConfig }).brand; document.documentElement.style.setProperty("--brand", safeBrand(M.brand.primaryColor)); }
    if (!ref || !token) { M.view = "missing"; return render(); }
    const r = await reloadAppointment();
    if (r.status !== 200) { M.view = "notfound"; return render(); }
    M.view = "details"; render();
  } catch { M.view = "notfound"; render(); }
})();
