import { applySelection } from "../../../packages/contracts/src/selection.js";
import { safeBrand } from "./theme.js";
import type { Selection, Step, BookingOutcome, PublicClinic, VisitType, PublicProvider, Slot, BrandConfig } from "@carex/contracts";

type Screen = "entry" | "state" | "clinic" | "visit" | "slot" | "review" | "result";
interface Data { states: string[]; clinics: PublicClinic[]; visitTypes: VisitType[]; providers: PublicProvider[]; slots: Slot[] }

const root = document.getElementById("app")!;
const slug = /^\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? "";
const API = `/t/${slug}/api`;
const KEY = `carex:${slug}`;

const S = {
  screen: "entry" as Screen, sel: {} as Selection, data: { states: [], clinics: [], visitTypes: [], providers: [], slots: [] } as Data,
  brand: undefined as BrandConfig | undefined, patient: { firstName: "", lastName: "", email: "", phone: "" },
  errors: {} as Record<string, string>, outcome: undefined as BookingOutcome | undefined, idemKey: "", busy: false,
  banner: undefined as { kind: "error" | "warning" | "info"; text: string } | undefined, loading: false,
};

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const STATES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };

// ---- API (availability from the server is always provisional)
async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12_000);
  try { const r = await fetch(API + path, { ...init, signal: ctl.signal }); return { status: r.status, body: await r.json() as T }; }
  finally { clearTimeout(t); }
}

// ---- helpers
const clinic = () => S.data.clinics.find((c) => c.id === S.sel.clinicId);
const visit = () => S.data.visitTypes.find((v) => v.id === S.sel.serviceId);
const provider = () => S.data.providers.find((p) => p.id === S.sel.providerId);
const slot = () => S.data.slots.find((s) => s.id === S.sel.slotId);
const tz = () => clinic()?.timeZone ?? "UTC";
const fmtDay = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(new Date(iso));
const fmtTime = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone }).format(new Date(iso));
const stateName = (c: string) => `${STATES[c] ?? c} (${c})`;
const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify({ sel: S.sel, screen: S.screen })); } catch { /* storage may be unavailable */ } };

const STEPS = ["Location", "Visit type", "Provider & time", "Confirm"];
const stepIndex: Record<Screen, number> = { entry: -1, state: 0, clinic: 0, visit: 1, slot: 2, review: 3, result: 3 };

function banner() {
  if (!S.banner) return "";
  const icon = { error: "Error:", warning: "Notice:", info: "Info:" }[S.banner.kind];
  return `<div class="banner ${S.banner.kind}" role="${S.banner.kind === "error" ? "alert" : "status"}"><span class="icon" aria-hidden="true">${S.banner.kind === "error" ? "✕" : S.banner.kind === "warning" ? "!" : "i"}</span><span class="text"><span class="sr-only">${icon} </span>${esc(S.banner.text)}</span></div>`;
}
function steps() {
  const cur = stepIndex[S.screen]; if (cur < 0) return "";
  return `<nav aria-label="Booking progress"><ol class="steps">${STEPS.map((n, i) => `<li class="${i < cur ? "done" : ""}"${i === cur ? ' aria-current="step"' : ""}>${i < cur ? '<span class="sr-only">Completed: </span>' : ""}${i + 1}. ${n}</li>`).join("")}</ol></nav>`;
}
function skeleton() { return `<div aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><p class="sr-only" role="status">Loading</p>`; }
function actions(back: Step | "none", primary: { id: string; label: string; disabled?: boolean } | null) {
  return `<div class="actions">${back !== "none" ? `<button type="button" data-act="back">Back</button>` : ""}${primary ? `<button type="button" class="primary" data-act="${primary.id}"${primary.disabled ? " disabled" : ""}>${esc(primary.label)}</button>` : ""}</div>`;
}
function radios(name: string, items: { id: string; title: string; sub?: string }[], selected?: string) {
  return items.map((i) => `<label class="choice"><input type="radio" name="${name}" value="${esc(i.id)}"${i.id === selected ? " checked" : ""}><span class="card"><span>${esc(i.title)}${i.sub ? `<small>${esc(i.sub)}</small>` : ""}</span><span class="badge" aria-hidden="true">Selected</span></span></label>`).join("");
}

function view(): string {
  const empty = (msg: string, changeLabel: string) => `<div class="banner info" role="status"><span class="icon" aria-hidden="true">i</span><span class="text">${esc(msg)}</span></div>${actions("none", null)}<div class="actions"><button type="button" data-act="back">${esc(changeLabel)}</button></div>`;
  switch (S.screen) {
    case "entry": return `<h1 tabindex="-1" id="h">Book an appointment</h1><p class="lead">Choose a location, visit type, provider and time. You will review everything before confirming.</p><div class="actions"><button type="button" class="primary" data-act="start">Book Now</button></div>`;
    case "state": return `<h1 tabindex="-1" id="h">Where would you like to be seen?</h1>${S.loading ? skeleton() : S.data.states.length === 0 ? empty("No locations are available right now.", "Back") : `<div style="margin-bottom:1rem"><label class="field" for="state">State</label><select id="state" aria-describedby="state-hint"><option value="">Select a state</option>${S.data.states.map((s) => `<option value="${s}"${S.sel.stateCode === s ? " selected" : ""}>${esc(stateName(s))}</option>`).join("")}</select><p class="hint" id="state-hint">Only states with bookable clinics are listed.</p></div>${actions("stateCode", { id: "next", label: "Continue", disabled: !S.sel.stateCode })}`}`;
    case "clinic": return `<h1 tabindex="-1" id="h">Choose a clinic</h1><p class="lead">State: ${esc(stateName(S.sel.stateCode ?? ""))}</p>${S.loading ? skeleton() : S.data.clinics.length === 0 ? empty(`No clinics are available in ${stateName(S.sel.stateCode ?? "")}.`, "Change state") : `<fieldset><legend class="sr-only">Clinics</legend>${radios("clinic", S.data.clinics.map((c) => ({ id: c.id, title: c.name, sub: c.address })), S.sel.clinicId)}</fieldset>${actions("clinicId", { id: "next", label: "Continue", disabled: !S.sel.clinicId })}`}`;
    case "visit": return `<h1 tabindex="-1" id="h">What type of visit do you need?</h1><p class="lead">${esc(clinic()?.name ?? "")}</p>${S.loading ? skeleton() : S.data.visitTypes.length === 0 ? empty("No visit types are available at this clinic.", "Change clinic") : `<fieldset><legend class="sr-only">Visit types</legend>${radios("visit", S.data.visitTypes.map((v) => ({ id: v.id, title: v.label, sub: v.description })), S.sel.serviceId)}</fieldset>${actions("serviceId", { id: "next", label: "Continue", disabled: !S.sel.serviceId })}`}`;
    case "slot": {
      const byDay = new Map<string, Slot[]>(); for (const s of S.data.slots) { const d = fmtDay(s.startsAt, tz()); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
      return `<h1 tabindex="-1" id="h">Choose a provider and time</h1><p class="lead">${esc(clinic()?.name ?? "")} · ${esc(visit()?.label ?? "")}</p>${banner()}${S.loading ? skeleton() : S.data.providers.length === 0 ? empty("No providers are currently available for this selection.", "Change visit type") : `<fieldset><legend>Provider</legend>${radios("provider", S.data.providers.map((p) => ({ id: p.id, title: p.displayName })), S.sel.providerId)}</fieldset>${S.sel.providerId ? (S.data.slots.length === 0 ? `<div class="banner info" role="status"><span class="icon" aria-hidden="true">i</span><span class="text">No times are currently available for this provider. Try refreshing or choose another provider.</span></div>` : `<p class="hint">Times are shown in ${esc(tz())}. Availability is provisional until you confirm.</p>${[...byDay].map(([d, ss]) => `<fieldset><legend>${esc(d)}</legend><div class="slots">${radios("slot", ss.map((s) => ({ id: s.id, title: fmtTime(s.startsAt, tz()) })), S.sel.slotId)}</div></fieldset>`).join("")}`) + `<div class="actions"><button type="button" data-act="refresh">Refresh availability</button></div>` : ""}${actions("providerId", { id: "next", label: "Continue", disabled: !S.sel.slotId })}`}`;
    }
    case "review": {
      const e = S.errors; const f = (id: string, label: string, type: string, val: string, ac: string) => `<div style="margin-bottom:.75rem"><label class="field" for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}" autocomplete="${ac}"${e[id] ? ` aria-invalid="true" aria-describedby="${id}-err"` : ""}>${e[id] ? `<div class="err" id="${id}-err" role="alert">${esc(e[id]!)}</div>` : ""}</div>`;
      return `<h1 tabindex="-1" id="h">Review your appointment</h1>${banner()}<dl class="summary"><dt>Clinic</dt><dd>${esc(clinic()?.name ?? "")}<br>${esc(clinic()?.address ?? "")}</dd><dt>Visit type</dt><dd>${esc(visit()?.label ?? "")}</dd><dt>Provider</dt><dd>${esc(provider()?.displayName ?? "")}</dd><dt>Date</dt><dd>${esc(slot() ? fmtDay(slot()!.startsAt, tz()) : "")}</dd><dt>Time</dt><dd>${esc(slot() ? fmtTime(slot()!.startsAt, tz()) : "")}</dd></dl><p class="hint"><button type="button" data-act="edit" style="min-height:0;padding:.25rem .5rem">Change choices</button></p><h2 style="font-size:1.125rem">Your details</h2><p class="hint">We only ask for what is needed to book. Provide an email or a phone number.</p>${f("firstName", "First name", "text", S.patient.firstName, "given-name")}${f("lastName", "Last name", "text", S.patient.lastName, "family-name")}${f("email", "Email", "email", S.patient.email, "email")}${f("phone", "Phone", "tel", S.patient.phone, "tel")}${e.contact ? `<div class="err" role="alert">${esc(e.contact)}</div>` : ""}<div class="actions"><button type="button" data-act="back">Back</button><button type="button" class="primary" data-act="confirm"${S.busy ? " disabled" : ""}>${S.busy ? "Confirming…" : "Confirm appointment"}</button></div>`;
    }
    case "result": {
      const o = S.outcome!;
      if (o.status === "confirmed") return `<h1 tabindex="-1" id="h">Appointment confirmed</h1><div class="banner success" role="status"><span class="icon" aria-hidden="true">✓</span><span class="text">Your booking reference is <strong>${esc(o.bookingId)}</strong>.</span></div><dl class="summary"><dt>Clinic</dt><dd>${esc(o.summary.clinic.name)}<br>${esc(o.summary.clinic.address)}</dd><dt>Visit type</dt><dd>${esc(o.summary.visitType.label)}</dd><dt>Provider</dt><dd>${esc(o.summary.provider.displayName)}</dd><dt>Date</dt><dd>${esc(fmtDay(o.summary.startsAt, o.summary.timeZone))}</dd><dt>Time</dt><dd>${esc(fmtTime(o.summary.startsAt, o.summary.timeZone))}</dd></dl><div class="actions"><button type="button" data-act="restart">Book another appointment</button></div>`;
      if (o.status === "pending") return `<h1 tabindex="-1" id="h">We're checking your booking</h1><div class="banner warning" role="status"><span class="icon" aria-hidden="true">!</span><span class="text">${esc(o.message)}</span></div><div class="actions"><button type="button" class="primary" data-act="check">Check status</button></div>`;
      if (o.status === "slot_unavailable") return `<h1 tabindex="-1" id="h">That time is no longer available</h1><div class="banner warning" role="alert"><span class="icon" aria-hidden="true">!</span><span class="text">${esc(o.message)}</span></div><div class="actions"><button type="button" class="primary" data-act="pickAnother">Choose another time</button></div>`;
      return `<h1 tabindex="-1" id="h">We couldn't complete your booking</h1><div class="banner error" role="alert"><span class="icon" aria-hidden="true">✕</span><span class="text">${esc(o.message)}</span></div><div class="actions"><button type="button" data-act="back">Back to review</button>${o.retryable ? `<button type="button" class="primary" data-act="confirm">Try again</button>` : ""}</div>`;
    }
  }
}

function render(focus = true) {
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `<header class="site"><div class="brand">${esc(S.brand?.displayName ?? "")}</div></header><main>${steps()}${S.screen === "slot" || S.screen === "review" ? "" : banner()}${view()}</main>`;
  document.title = `${S.brand?.displayName ? S.brand.displayName + " – " : ""}Book an appointment`;
  if (focus) (document.getElementById("h") as HTMLElement | null)?.focus();
  save();
}

async function load<T>(fn: () => Promise<T>): Promise<T | undefined> {
  S.loading = true; S.banner = undefined; render();
  try { return await fn(); }
  catch { S.banner = { kind: "error", text: "We couldn't load this information. Please check your connection and try again." }; return undefined; }
  finally { S.loading = false; }
}

async function goState() { S.screen = "state"; const r = await load(() => api<{ states: string[] }>("/states")); if (r) S.data.states = r.body.states; render(); }
async function goClinic() { S.screen = "clinic"; const r = await load(() => api<{ clinics: PublicClinic[] }>(`/clinics?state=${encodeURIComponent(S.sel.stateCode!)}`)); if (r) S.data.clinics = r.body.clinics; render(); }
async function goVisit() { S.screen = "visit"; const r = await load(() => api<{ visitTypes: VisitType[] }>(`/clinics/${encodeURIComponent(S.sel.clinicId!)}/visit-types`)); if (r) S.data.visitTypes = r.body.visitTypes; render(); }
async function loadSlots() {
  if (!S.sel.providerId) { S.data.slots = []; return; }
  const q = `clinicId=${encodeURIComponent(S.sel.clinicId!)}&serviceId=${encodeURIComponent(S.sel.serviceId!)}&providerId=${encodeURIComponent(S.sel.providerId)}`;
  const r = await api<{ slots: Slot[] }>(`/slots?${q}`); S.data.slots = r.body.slots;
  if (S.sel.slotId && !S.data.slots.some((s) => s.id === S.sel.slotId)) { S.sel = applySelection(S.sel, "slotId", undefined); }   // never trust a stale slot
}
async function goSlot() {
  S.screen = "slot";
  const r = await load(async () => { const p = await api<{ providers: PublicProvider[] }>(`/providers?clinicId=${encodeURIComponent(S.sel.clinicId!)}&serviceId=${encodeURIComponent(S.sel.serviceId!)}`); S.data.providers = p.body.providers; if (S.sel.providerId && !S.data.providers.some((x) => x.id === S.sel.providerId)) S.sel = applySelection(S.sel, "providerId", undefined); await loadSlots(); return true; });
  void r; render();
}

const back: Record<Screen, () => void> = {
  entry: () => {}, state: () => { S.screen = "entry"; render(); }, clinic: () => void goState(), visit: () => void goClinic(), slot: () => void goVisit(),
  review: () => void goSlot(), result: () => { S.screen = "review"; render(); },
};

async function onAct(act: string) {
  switch (act) {
    case "start": return goState();
    case "back": return back[S.screen]();
    case "next":
      if (S.screen === "state" && S.sel.stateCode) return goClinic();
      if (S.screen === "clinic" && S.sel.clinicId) return goVisit();
      if (S.screen === "visit" && S.sel.serviceId) return goSlot();
      if (S.screen === "slot" && S.sel.slotId) { S.screen = "review"; S.banner = undefined; S.errors = {}; return render(); }
      return;
    case "refresh": { S.banner = undefined; await load(loadSlots); render(false); S.banner = { kind: "info", text: "Availability refreshed." }; render(false); (document.querySelector('[data-act="refresh"]') as HTMLElement | null)?.focus(); return; }
    case "edit": return goSlot();
    case "restart": S.sel = {}; S.outcome = undefined; S.idemKey = ""; S.patient = { firstName: "", lastName: "", email: "", phone: "" }; return goState();
    case "pickAnother": S.sel = applySelection(S.sel, "slotId", undefined); S.idemKey = ""; S.banner = { kind: "warning", text: "That time was taken. Your other choices are kept; please pick another time." }; return goSlot();
    case "check": return check();
    case "confirm": return confirm();
  }
}

function validate(): boolean {
  const p = S.patient; const e: Record<string, string> = {};
  if (!p.firstName.trim()) e.firstName = "Enter your first name."; if (!p.lastName.trim()) e.lastName = "Enter your last name.";
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) e.email = "Enter a valid email address.";
  if (p.phone && !/^[0-9+() .-]{7,20}$/.test(p.phone)) e.phone = "Enter a valid phone number.";
  if (!p.email && !p.phone) e.contact = "Enter an email address or a phone number.";
  S.errors = e; return Object.keys(e).length === 0;
}

async function confirm() {
  if (S.busy) return;                                                  // duplicate-click guard (server-side idempotency is the real protection)
  syncForm();
  if (!validate()) { render(false); (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(); return; }
  S.busy = true; S.banner = undefined; render(false);
  if (!S.idemKey) S.idemKey = crypto.randomUUID();
  try {
    const body = { clinicId: S.sel.clinicId, serviceId: S.sel.serviceId, providerId: S.sel.providerId, slotId: S.sel.slotId, confirmed: true, patient: { firstName: S.patient.firstName.trim(), lastName: S.patient.lastName.trim(), ...(S.patient.email ? { email: S.patient.email.trim() } : {}), ...(S.patient.phone ? { phone: S.patient.phone.trim() } : {}) } };
    const r = await api<BookingOutcome | { error: { code: string } }>("/bookings", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": S.idemKey }, body: JSON.stringify(body) });
    if ("status" in r.body) S.outcome = r.body;
    else S.outcome = { status: "failed", code: r.body.error.code, message: r.status === 404 ? "This selection is no longer available. Please start again." : "We couldn't complete your booking. No appointment was created.", retryable: r.status >= 500 };
  } catch {
    // Network timeout: the outcome is UNKNOWN. Never say it failed or succeeded; keep the same key so a retry cannot double-book.
    S.outcome = { status: "pending", correlationId: S.idemKey, message: "We couldn't confirm whether your appointment was booked. Please don't book again; check the status below." };
  }
  S.busy = false; S.screen = "result"; render();
}

async function check() {
  try {
    const r = await api<BookingOutcome>(`/bookings/by-key/${encodeURIComponent(S.idemKey)}`);
    if (r.status === 200) S.outcome = r.body;
    else S.outcome = { status: "failed", code: "not_booked", message: "No booking was found for that attempt, so nothing was booked. You can safely try again.", retryable: true };
  } catch { S.outcome = { status: "pending", correlationId: S.idemKey, message: "Still unable to check. Please try again in a moment." }; }
  render();
}

function syncForm() {
  for (const id of ["firstName", "lastName", "email", "phone"] as const) { const el = document.getElementById(id) as HTMLInputElement | null; if (el) S.patient[id] = el.value; }
}

root.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest("button[data-act]") as HTMLElement | null; if (b && !(b as HTMLButtonElement).disabled) void onAct(b.dataset.act!); });
root.addEventListener("change", async (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const set = (step: Step, v: string | undefined) => { S.sel = applySelection(S.sel, step, v); };
  if (t.id === "state") { set("stateCode", t.value || undefined); render(false); (document.getElementById("state") as HTMLElement).focus(); }
  else if (t.name === "clinic") { set("clinicId", t.value); S.idemKey = ""; render(false); focusRadio("clinic", t.value); }
  else if (t.name === "visit") { set("serviceId", t.value); S.idemKey = ""; render(false); focusRadio("visit", t.value); }
  else if (t.name === "provider") { set("providerId", t.value); S.idemKey = ""; S.data.slots = []; await load(loadSlots); render(false); focusRadio("provider", t.value); }
  else if (t.name === "slot") { set("slotId", t.value); S.idemKey = ""; render(false); focusRadio("slot", t.value); }
});
root.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id in S.patient) (S.patient as Record<string, string>)[t.id] = t.value; });
function focusRadio(name: string, value: string) { (document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`) as HTMLElement | null)?.focus(); }

// ---- boot: tenant config, then revalidate any saved selection against the server (FR-009)
async function boot() {
  try {
    const r = await api<{ brand: BrandConfig }>("/config");
    if (r.status !== 200) throw new Error("no tenant");
    S.brand = r.body.brand;
    document.documentElement.style.setProperty("--brand", safeBrand(S.brand.primaryColor));
  } catch {
    root.setAttribute("aria-busy", "false");
    root.innerHTML = `<main><h1 tabindex="-1" id="h">This booking page isn't available</h1><p class="lead">Please check the link or contact the clinic directly.</p></main>`;
    document.title = "Booking unavailable"; (document.getElementById("h") as HTMLElement).focus(); return;
  }
  let saved: { sel?: Selection } = {};
  try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? "{}"); } catch { /* ignore */ }
  const sv = saved.sel;
  if (sv?.stateCode) {
    try {
      const st = await api<{ states: string[] }>("/states"); S.data.states = st.body.states;
      let sel: Selection = {};
      if (S.data.states.includes(sv.stateCode)) {
        sel.stateCode = sv.stateCode;
        const cl = await api<{ clinics: PublicClinic[] }>(`/clinics?state=${sel.stateCode}`); S.data.clinics = cl.body.clinics;
        if (sv.clinicId && S.data.clinics.some((c) => c.id === sv.clinicId)) {
          sel.clinicId = sv.clinicId;
          const vt = await api<{ visitTypes: VisitType[] }>(`/clinics/${sel.clinicId}/visit-types`); S.data.visitTypes = vt.body.visitTypes;
          if (sv.serviceId && S.data.visitTypes.some((v) => v.id === sv.serviceId)) { sel.serviceId = sv.serviceId; if (sv.providerId) sel.providerId = sv.providerId; if (sv.slotId) sel.slotId = sv.slotId; }
        }
      }
      S.sel = sel;
      if (sel.serviceId) { await goSlot(); return; }          // slots and providers are revalidated in goSlot()
      if (sel.clinicId) { await goVisit(); return; }
      if (sel.stateCode) { await goClinic(); return; }
    } catch { S.sel = {}; }
  }
  S.screen = "entry"; render();
}
void boot();
