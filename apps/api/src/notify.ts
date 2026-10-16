import type { Db } from "./db.js";

/** Outbound channels. Either may be absent (not configured): the message is then skipped with a clear reason, never silently lost. */
export interface Channels {
  email?(m: { to: string; subject: string; text: string }): Promise<void>;
  sms?(m: { to: string; text: string }): Promise<void>;
  /** Public origin of the app, used for manage links (https://host). */
  baseUrl: string;
}

export type Kind = "confirmation" | "reminder_24h" | "reminder_2h" | "cancellation" | "rescheduled" | "waitlist_open";
const HOUR = 3_600_000;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;

/** Queue messages inside the booking transaction (so a booking and its messages commit or roll back together). */
export async function enqueue(tx: Db, now: Date, m: { tenantId: string; kind: Kind; appointmentId?: string; userId: string; waitlistId?: number; sendAfter?: Date; dedupe: string }): Promise<void> {
  for (const channel of ["email", "sms"] as const) {
    await tx.run(
      `INSERT INTO outbox (tenant_id, kind, channel, appointment_id, user_id, waitlist_id, send_after, created_at, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      m.tenantId, m.kind, channel, m.appointmentId ?? null, m.userId, m.waitlistId ?? null, (m.sendAfter ?? now).toISOString(), now.toISOString(), `${m.dedupe}:${channel}`);
  }
}

/** Reminders 24 h and 2 h before the start, for the CURRENT start time (a reschedule skips the old ones and queues new ones). */
export async function enqueueReminders(tx: Db, now: Date, a: { tenantId: string; appointmentId: string; userId: string; startsAt: string }): Promise<void> {
  const start = Date.parse(a.startsAt);
  for (const [kind, lead] of [["reminder_24h", 24 * HOUR], ["reminder_2h", 2 * HOUR]] as const) {
    const at = start - lead;
    if (at <= now.getTime()) continue;                       // booked too close to the visit for this reminder
    await enqueue(tx, now, { tenantId: a.tenantId, kind, appointmentId: a.appointmentId, userId: a.userId, sendAfter: new Date(at), dedupe: `${kind}:${a.appointmentId}:${a.startsAt}` });
  }
}

export async function skipPendingReminders(tx: Db, appointmentId: string): Promise<void> {
  await tx.run("UPDATE outbox SET status = 'skipped', last_error = 'superseded' WHERE appointment_id = ? AND status = 'pending' AND kind IN ('reminder_24h','reminder_2h')", appointmentId);
}

interface Row {
  id: number; tenant_id: string; kind: Kind; channel: "email" | "sms"; appointment_id: string | null; waitlist_id: number | null; attempts: number;
  a_status: string | null; starts_at: string | null; modality: string | null; join_url: string | null; copay_cents: number | null; patient_first_name: string | null; cancel_reason: string | null; late_cancel: number | null;
  tenant_name: string; slug: string; support_email: string | null; support_phone: string | null; policy_text: string; late_cancel_hours: number;
  clinic_name: string | null; address: string | null; time_zone: string | null; visit_label: string | null; provider_name: string | null;
  email: string | null; phone: string | null; first_name: string | null; notify_email: number; notify_sms: number;
}

const SELECT = `
  SELECT o.id, o.tenant_id, o.kind, o.channel, o.appointment_id, o.waitlist_id, o.attempts,
         a.status AS a_status, a.starts_at, a.modality, a.join_url, a.copay_cents, a.patient_first_name, a.cancel_reason, a.late_cancel,
         t.display_name AS tenant_name, t.slug, t.support_email, t.support_phone, t.policy_text, t.late_cancel_hours,
         COALESCE(c.name, wc.name) AS clinic_name, COALESCE(c.address, wc.address) AS address, COALESCE(c.time_zone, wc.time_zone) AS time_zone,
         COALESCE(v.label, wv.label) AS visit_label, COALESCE(p.display_name, wp.display_name) AS provider_name,
         u.email, u.phone, u.first_name, u.notify_email, u.notify_sms
    FROM outbox o
    JOIN tenants t ON t.id = o.tenant_id
    JOIN users u ON u.id = o.user_id
    LEFT JOIN appointments a ON a.id = o.appointment_id
    LEFT JOIN clinics c ON c.id = a.clinic_id LEFT JOIN visit_types v ON v.id = a.visit_type_id LEFT JOIN providers p ON p.id = a.provider_id
    LEFT JOIN waitlist w ON w.id = o.waitlist_id
    LEFT JOIN clinics wc ON wc.id = w.clinic_id LEFT JOIN visit_types wv ON wv.id = w.visit_type_id LEFT JOIN providers wp ON wp.id = w.provider_id`;

function when(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** Plain-text message for one outbox row. Rendered at send time so it always shows the booking as it is NOW. */
export function render(r: Row, baseUrl: string): { subject: string; text: string; sms: string } | undefined {
  const manage = `${baseUrl.replace(/\/$/, "")}/t/${r.slug}/manage`;
  const where = r.modality === "telehealth" ? `Video visit${r.join_url ? `: ${r.join_url}` : ""}` : `${r.clinic_name}, ${r.address}`;
  const sign = `\n\n${r.tenant_name}${r.support_phone ? ` · ${r.support_phone}` : ""}${r.support_email ? ` · ${r.support_email}` : ""}`;
  const hello = `Hi ${r.first_name ?? "there"},`;
  const details = r.starts_at && r.time_zone ? `${r.visit_label} with ${r.provider_name}${r.patient_first_name && r.patient_first_name !== r.first_name ? ` for ${r.patient_first_name}` : ""}\n${when(r.starts_at, r.time_zone)}\n${where}` : "";
  const policy = r.policy_text ? `\n\n${r.policy_text}` : `\n\nPlease change or cancel at least ${r.late_cancel_hours} hours ahead so someone else can use the time.`;
  const copay = r.copay_cents ? `\nExpected copay: $${(r.copay_cents / 100).toFixed(2)}, due at the visit.` : "";
  switch (r.kind) {
    case "confirmation":
      return { subject: `Appointment confirmed — ${r.visit_label}`, text: `${hello}\n\nYour appointment is confirmed.\n\n${details}${copay}\n\nManage it: ${manage}${policy}\n\nThis is not for emergencies. In an emergency call 911.${sign}`, sms: `${r.tenant_name}: confirmed ${r.visit_label}, ${when(r.starts_at!, r.time_zone!)}. Manage: ${manage}` };
    case "reminder_24h":
      return { subject: `Reminder: appointment tomorrow — ${r.visit_label}`, text: `${hello}\n\nA reminder about your appointment in about 24 hours.\n\n${details}\n\nNeed to change it? ${manage}${sign}`, sms: `${r.tenant_name} reminder: ${r.visit_label} ${when(r.starts_at!, r.time_zone!)}. Manage: ${manage}` };
    case "reminder_2h":
      return { subject: `Starting soon — ${r.visit_label}`, text: `${hello}\n\nYour appointment starts in about 2 hours.\n\n${details}${sign}`, sms: `${r.tenant_name}: ${r.visit_label} starts in ~2 hours (${when(r.starts_at!, r.time_zone!)}).` };
    case "cancellation":
      return { subject: `Appointment cancelled — ${r.visit_label}`, text: `${hello}\n\nYour appointment has been cancelled.\n\n${details}${r.late_cancel ? `\n\nThis was inside the ${r.late_cancel_hours}-hour cancellation window and may be recorded as a late cancellation.` : ""}\n\nBook a new time: ${manage}${sign}`, sms: `${r.tenant_name}: your ${r.visit_label} on ${when(r.starts_at!, r.time_zone!)} is cancelled.` };
    case "rescheduled":
      return { subject: `Appointment moved — ${r.visit_label}`, text: `${hello}\n\nYour appointment has a new time.\n\n${details}\n\nManage it: ${manage}${sign}`, sms: `${r.tenant_name}: moved to ${when(r.starts_at!, r.time_zone!)}. Manage: ${manage}` };
    case "waitlist_open":
      return { subject: `A time opened up — ${r.visit_label}`, text: `${hello}\n\nA ${r.visit_label} slot just opened at ${r.clinic_name}${r.provider_name ? ` with ${r.provider_name}` : ""}. Times go quickly: ${baseUrl.replace(/\/$/, "")}/t/${r.slug}/${sign}`, sms: `${r.tenant_name}: a ${r.visit_label} time opened at ${r.clinic_name}. Book: ${baseUrl.replace(/\/$/, "")}/t/${r.slug}/` };
  }
}

export interface DispatchResult { sent: number; skipped: number; failed: number; retried: number }

/** Sends due messages. Safe to run from several workers at once: each row is leased before it is sent. */
export class Notifier {
  constructor(private db: Db, private channels: Channels, private now: () => Date = () => new Date()) {}

  async dispatch(opts: { limit?: number; appointmentId?: string } = {}): Promise<DispatchResult> {
    const res: DispatchResult = { sent: 0, skipped: 0, failed: 0, retried: 0 };
    const nowIso = this.now().toISOString();
    const due = await this.db.all<Row>(`${SELECT} WHERE o.status = 'pending' AND o.send_after <= ? ${opts.appointmentId ? "AND o.appointment_id = ?" : ""} ORDER BY o.id LIMIT ?`,
      ...[nowIso, ...(opts.appointmentId ? [opts.appointmentId] : []), opts.limit ?? 100]);
    for (const r of due) {
      const lease = new Date(this.now().getTime() + LEASE_MS).toISOString();
      const claimed = await this.db.run("UPDATE outbox SET attempts = attempts + 1, send_after = ? WHERE id = ? AND status = 'pending' AND send_after <= ?", lease, r.id, nowIso);
      if (claimed.changes === 0) continue;                                   // another worker has it
      const skip = this.skipReason(r);
      if (skip) { await this.finish(r.id, "skipped", skip); res.skipped++; continue; }
      try {
        const msg = render(r, this.channels.baseUrl);
        if (!msg) { await this.finish(r.id, "skipped", "no_template"); res.skipped++; continue; }
        if (r.channel === "email") await this.channels.email!({ to: r.email!, subject: msg.subject, text: msg.text });
        else await this.channels.sms!({ to: r.phone!, text: msg.sms });
        await this.finish(r.id, "sent"); res.sent++;
      } catch (e) {
        const last = r.attempts + 1 >= MAX_ATTEMPTS;
        const reason = (e instanceof Error ? e.message : "send_failed").slice(0, 200);
        if (last) { await this.finish(r.id, "failed", reason); res.failed++; }
        else { await this.db.run("UPDATE outbox SET last_error = ?, send_after = ? WHERE id = ?", reason, new Date(this.now().getTime() + r.attempts * 5 * 60_000 + 60_000).toISOString(), r.id); res.retried++; }
      }
    }
    return res;
  }

  private skipReason(r: Row): string | undefined {
    if (r.channel === "email" && (!this.channels.email || r.notify_email !== 1 || !r.email)) return !this.channels.email ? "email_not_configured" : "recipient_opted_out";
    if (r.channel === "sms" && (!this.channels.sms || r.notify_sms !== 1 || !r.phone)) return !this.channels.sms ? "sms_not_configured" : "recipient_not_opted_in";
    if (r.kind === "reminder_24h" || r.kind === "reminder_2h") {
      if (r.a_status !== "confirmed") return "appointment_not_confirmed";
      if (!r.starts_at || Date.parse(r.starts_at) <= this.now().getTime()) return "appointment_started";
    }
    if (r.kind === "waitlist_open") return undefined;
    return undefined;
  }

  private finish(id: number, status: "sent" | "skipped" | "failed", err?: string) {
    return this.db.run("UPDATE outbox SET status = ?, last_error = ?, sent_at = ? WHERE id = ?", status, err ?? null, this.now().toISOString(), id);
  }
}
