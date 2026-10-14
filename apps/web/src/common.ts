// Small helpers shared by the booking and manage pages.
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const fmtDay = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone }).format(new Date(iso));
export const fmtTime = (iso: string, zone: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone: zone }).format(new Date(iso));

export type Banner = { kind: "error" | "warning" | "info" | "success"; text: string } | undefined;
export function bannerHtml(b: Banner): string {
  if (!b) return "";
  const icon = { error: "Error:", warning: "Notice:", info: "Info:", success: "Done:" }[b.kind];
  const glyph = { error: "✕", warning: "!", info: "i", success: "✓" }[b.kind];
  return `<div class="banner ${b.kind}" role="${b.kind === "error" ? "alert" : "status"}"><span class="icon" aria-hidden="true">${glyph}</span><span class="text"><span class="sr-only">${icon} </span>${esc(b.text)}</span></div>`;
}

export function radiosHtml(name: string, items: { id: string; title: string }[], selected?: string): string {
  return items.map((i) => `<label class="choice"><input type="radio" name="${name}" value="${esc(i.id)}"${i.id === selected ? " checked" : ""}><span class="card"><span>${esc(i.title)}</span><span class="badge" aria-hidden="true">Selected</span></span></label>`).join("");
}

/** An RFC 5545 calendar entry for an appointment (UTC times, so every calendar app shows the right local time). */
export function icsFor(a: { bookingId: string; clinicName: string; address: string; startsAt: string; endsAt: string; label: string }): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CareX//Booking//EN", "BEGIN:VEVENT", `UID:${a.bookingId}@carex`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(a.startsAt)}`, `DTEND:${stamp(a.endsAt)}`, `SUMMARY:${text(a.label)}`, `LOCATION:${text(`${a.clinicName}, ${a.address}`)}`, `DESCRIPTION:${text(`Booking reference ${a.bookingId}`)}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

export function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- accounts (ADR-005): who is signed in, redirect to login, shared header
export interface Me { id: string; email: string; firstName: string; lastName: string; dateOfBirth: string; phone: string; access: { type: "employer" | "insurer"; id: string; name: string } }
export const tenantSlug = () => /^\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? "";

/** Sends the visitor to the login page and brings them back to where they were. Only same-tenant paths are accepted as `next`. */
export function toLogin(): void {
  const next = location.pathname + location.search;
  location.replace(`/t/${tenantSlug()}/login?next=${encodeURIComponent(next)}`);
}
export function safeNext(raw: string | null): string {
  const home = `/t/${tenantSlug()}/`;
  return raw && raw.startsWith(home) && !raw.startsWith("//") && !raw.includes("\\") ? raw : home;
}
export async function fetchMe(): Promise<Me | undefined> {
  try { const r = await fetch(`/t/${tenantSlug()}/api/auth/me`); return r.status === 200 ? ((await r.json()) as { user: Me }).user : undefined; } catch { return undefined; }
}
export async function logout(): Promise<void> {
  try { await fetch(`/t/${tenantSlug()}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); } catch { /* the server session may linger until it expires; the cookie is cleared by the response when it arrives */ }
  location.assign(`/t/${tenantSlug()}/login`);
}
export function headerHtml(brandName: string, me: Me | undefined, current: "book" | "appointments" | "none" = "none"): string {
  const s = tenantSlug();
  const nav = me ? `<nav class="topnav" aria-label="Account"><a href="/t/${s}/"${current === "book" ? ' aria-current="page"' : ""}>Book</a><a href="/t/${s}/appointments"${current === "appointments" ? ' aria-current="page"' : ""}>My appointments</a><span class="who">${esc(me.firstName)}</span><button type="button" class="linkish" data-act="logout">Log out</button></nav>` : "";
  return `<header class="site"><div class="brand">${esc(brandName)}</div>${nav}</header>`;
}
