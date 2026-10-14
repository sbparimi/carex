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
