// P3: transactional outbox, email/SMS dispatch, reminders, cancellation policy, waitlist, cron endpoint.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startApi, NOW, type Api, type Client } from "./helpers.js";
import type { Channels } from "../src/notify.js";

const NW = "/t/northwind-health/api";
let api: Api; let me: Client; let sam: Client; let now: Date; let n = 0;
let emails: { to: string; subject: string; text: string }[]; let texts: { to: string; text: string }[]; let failEmail = false;
const channels = (): Channels => ({
  baseUrl: "https://carex.example.test",
  email: async (m) => { if (failEmail) throw new Error("provider down"); emails.push(m); },
  sms: async (m) => { texts.push(m); },
});
const sql = (q: string, ...p: unknown[]) => api.app.db.run(q, ...p);
const rows = (q: string, ...p: unknown[]) => api.app.db.all<any>(q, ...p);

beforeEach(async () => {
  now = new Date(NOW); emails = []; texts = []; failEmail = false;
  api = await startApi({ now: () => now, channels: channels(), cronSecret: "cron-secret-for-tests-0123456789" });
  me = api.client(); sam = api.client();
  await me.signup("northwind-health"); await sam.signup("northwind-health", { email: "sam@example.test", firstName: "Sam", lastName: "Waiting", phone: "+1 555 010 0200" });
});
afterEach(() => api.close());

const slots = async (c: Client = me) => (await c.get(`${NW}/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).body.slots as { id: string; startsAt: string }[];
const book = (slotId: string, c: Client = me) => c.post(`${NW}/bookings`, { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId, confirmed: true }, { "idempotency-key": `key-notify-${++n}-xxxxxxxx` });

describe("confirmation", () => {
  it("queues a confirmation and two reminders per channel, and emails the confirmation straight away", async () => {
    const s = (await slots()).find((x) => x.startsAt >= "2026-11-04")!;     // far enough ahead for both reminders
    const r = await book(s.id);
    expect(r.status).toBe(201);
    const q = await rows("SELECT kind, channel, status FROM outbox WHERE appointment_id = ? ORDER BY kind, channel", r.body.bookingId);
    expect(q.map((x) => `${x.kind}/${x.channel}`)).toEqual(["confirmation/email", "confirmation/sms", "reminder_24h/email", "reminder_24h/sms", "reminder_2h/email", "reminder_2h/sms"]);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "pat.synthetic@example.test", subject: expect.stringMatching(/confirmed/i) });
    expect(emails[0]!.text).toMatch(/Northwind Health/); expect(emails[0]!.text).toMatch(/https:\/\/carex\.example\.test\/t\/northwind-health\/manage/);
    expect(emails[0]!.text).toMatch(/PST|PDT/);                                 // clinic-local time with zone
    expect(texts).toHaveLength(0);                                              // SMS is opt-in
    expect((await rows("SELECT status, last_error FROM outbox WHERE kind = 'confirmation' AND channel = 'sms'"))[0]).toMatchObject({ status: "skipped", last_error: "recipient_not_opted_in" });
  });
  it("texts people who opted in", async () => {
    expect((await me.post(`${NW}/notifications`, { sms: true })).body.notify).toEqual({ email: true, sms: true });
    const s = (await slots())[0]!; await book(s.id);
    expect(texts).toHaveLength(1); expect(texts[0]!.to).toBe("+31 6 1234 5678"); expect(texts[0]!.text).toMatch(/confirmed/);
  });
  it("respects an email opt-out", async () => {
    await me.post(`${NW}/notifications`, { email: false });
    await book((await slots())[0]!.id);
    expect(emails).toHaveLength(0);
  });
  it("skips (and says why) when a channel isn't configured", async () => {
    await api.close();
    api = await startApi({ now: () => now });
    me = api.client(); await me.signup("northwind-health");
    await book((await slots())[0]!.id);
    expect((await rows("SELECT DISTINCT last_error FROM outbox WHERE kind = 'confirmation' ORDER BY last_error")).map((x) => x.last_error)).toEqual(["email_not_configured", "sms_not_configured"]);
  });
});

describe("reminders", () => {
  it("sends the 24-hour reminder once, when due, and not before", async () => {
    const s = (await slots()).find((x) => x.startsAt >= "2026-11-04")!;
    await book(s.id); emails.length = 0;
    await api.app.notifier.dispatch(); expect(emails).toHaveLength(0);          // nothing due yet
    now = new Date(Date.parse(s.startsAt) - 23 * 3_600_000);
    const a = await api.app.notifier.dispatch(); expect(a.sent).toBe(1);
    expect(emails).toHaveLength(1); expect(emails[0]!.subject).toMatch(/Reminder/);
    await api.app.notifier.dispatch(); expect(emails).toHaveLength(1);          // idempotent
    now = new Date(Date.parse(s.startsAt) - 90 * 60_000);
    await api.app.notifier.dispatch(); expect(emails).toHaveLength(2); expect(emails[1]!.subject).toMatch(/Starting soon/);
  });
  it("does not remind after a cancellation, and sends the cancellation notice", async () => {
    const s = (await slots()).find((x) => x.startsAt >= "2026-11-04")!;
    const b = await book(s.id); emails.length = 0;
    const c = await me.post(`${NW}/bookings/${b.body.bookingId}/cancel`, { reason: "Feeling better" });
    expect(c.status).toBe(200);
    expect(emails.map((e) => e.subject)).toEqual([expect.stringMatching(/cancelled/i)]);
    expect((await rows("SELECT status FROM outbox WHERE kind LIKE 'reminder%' AND channel = 'email'")).every((x) => x.status === "skipped")).toBe(true);
    now = new Date(Date.parse(s.startsAt) - 23 * 3_600_000); await api.app.notifier.dispatch();
    expect(emails).toHaveLength(1);
    expect((await rows("SELECT cancel_reason, cancelled_by, late_cancel FROM appointments"))[0]).toEqual({ cancel_reason: "Feeling better", cancelled_by: "patient", late_cancel: 0 });
  });
  it("moves reminders with a reschedule and says so", async () => {
    const all = await slots();
    const first = all.find((x) => x.startsAt >= "2026-11-04")!, second = all.find((x) => x.startsAt >= "2026-11-05T17")!;
    const b = await book(first.id); emails.length = 0;
    const r = await me.post(`${NW}/bookings/${b.body.bookingId}/reschedule`, { slotId: second.id });
    expect(r.status).toBe(200);
    await api.app.notifier.dispatch();
    expect(emails.map((e) => e.subject)).toEqual([expect.stringMatching(/moved/i)]);
    const live = await rows("SELECT kind FROM outbox WHERE status = 'pending' AND channel = 'email' ORDER BY kind");
    expect(live.map((x) => x.kind)).toEqual(["reminder_24h", "reminder_2h"]);
    now = new Date(Date.parse(first.startsAt) - 23 * 3_600_000); emails.length = 0;
    await api.app.notifier.dispatch(); expect(emails).toHaveLength(0);          // the old time no longer triggers anything
  });
});

describe("late cancellation", () => {
  it("flags a cancel inside the policy window and not outside it", async () => {
    const all = await slots();
    const soon = all.find((x) => x.startsAt >= "2026-11-02T17")!, later = all.find((x) => x.startsAt >= "2026-11-06")!;
    const a = await book(soon.id), b = await book(later.id);
    await me.post(`${NW}/bookings/${a.body.bookingId}/cancel`, {});
    await me.post(`${NW}/bookings/${b.body.bookingId}/cancel`, {});
    const r = await rows("SELECT id, late_cancel FROM appointments");
    expect(r.find((x) => x.id === a.body.bookingId).late_cancel).toBe(1);
    expect(r.find((x) => x.id === b.body.bookingId).late_cancel).toBe(0);
    expect(emails.find((e) => /cancelled/i.test(e.subject) && /cancellation window/.test(e.text))).toBeTruthy();
  });
});

describe("delivery failures", () => {
  it("retries with a delay, then gives up after five attempts, without breaking the booking", async () => {
    failEmail = true;
    const s = (await slots())[0]!;
    expect((await book(s.id)).status).toBe(201);
    for (let i = 0; i < 6; i++) { now = new Date(now.getTime() + 2 * 3_600_000); await api.app.notifier.dispatch(); }
    const row = (await rows("SELECT status, attempts, last_error FROM outbox WHERE kind = 'confirmation' AND channel = 'email'"))[0];
    expect(row).toMatchObject({ status: "failed", attempts: 5, last_error: "provider down" });
  });
  it("two workers never send the same message twice", async () => {
    await book((await slots())[0]!.id); emails.length = 0;
    await sql("UPDATE outbox SET status = 'pending', send_after = '2000-01-01T00:00:00.000Z' WHERE kind = 'confirmation' AND channel = 'email'");
    await Promise.all([api.app.notifier.dispatch(), api.app.notifier.dispatch()]);
    expect(emails).toHaveLength(1);
  });
});

describe("waitlist", () => {
  const join = (c: Client, body: object = { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a" }) => c.post(`${NW}/waitlist`, body);
  it("joins once, lists, and leaves; rejects bad input", async () => {
    const a = await join(sam); expect(a.status).toBe(201);
    expect((await join(sam)).body.entry.id).toBe(a.body.entry.id);              // no duplicates
    const l = (await sam.get(`${NW}/waitlist`)).body.entries;
    expect(l).toHaveLength(1); expect(l[0]).toMatchObject({ clinicName: "San Bernardo Clinic", visitLabel: "Primary Care", providerName: "Dr. Alex Example" });
    expect((await me.get(`${NW}/waitlist`)).body.entries).toHaveLength(0);       // another account's list is empty
    expect((await me.post(`${NW}/waitlist/${a.body.entry.id}/leave`, {})).status).toBe(404);
    expect((await sam.post(`${NW}/waitlist/${a.body.entry.id}/leave`, {})).status).toBe(200);
    expect((await join(sam, { clinicId: "cl-sb", serviceId: "sv-vision-n" })).status).toBe(404);   // not offered there
    expect((await join(sam, { clinicId: "bad id", serviceId: "sv-pc-n" })).status).toBe(400);
  });
  it("tells the first people waiting when a time frees up, and closes their entry when they book", async () => {
    await join(sam);
    const s = (await slots()).find((x) => x.startsAt >= "2026-11-04")!;
    const b = await book(s.id); emails.length = 0;
    await me.post(`${NW}/bookings/${b.body.bookingId}/cancel`, {});
    await api.app.notifier.dispatch();
    expect(emails.map((e) => `${e.to}|${e.subject}`)).toEqual(expect.arrayContaining(["sam@example.test|A time opened up — Primary Care"]));
    expect((await rows("SELECT status FROM waitlist"))[0].status).toBe("notified");
    await book((await slots(sam))[0]!.id, sam);
    expect((await rows("SELECT status FROM waitlist"))[0].status).toBe("booked");
  });
});

describe("cron dispatch endpoint", () => {
  const call = (auth?: string) => api.client().call("POST", "/internal/dispatch", undefined, auth ? { authorization: auth } : {});
  it("needs the secret and sends what is due", async () => {
    await book((await slots())[0]!.id);
    await sql("UPDATE outbox SET status = 'pending', send_after = '2000-01-01T00:00:00.000Z' WHERE channel = 'email' AND kind = 'confirmation'");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    const ok = await call("Bearer cron-secret-for-tests-0123456789");
    expect(ok.status).toBe(200); expect(ok.body.sent).toBe(1);
  });
  it("does not exist when no secret is configured", async () => {
    await api.close(); api = await startApi({ now: () => now });
    expect((await api.client().call("POST", "/internal/dispatch", undefined, { authorization: "Bearer x" })).status).toBe(404);
  });
});
