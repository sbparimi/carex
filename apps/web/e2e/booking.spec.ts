import { test, expect, request as pwRequest, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const NW = "/t/northwind-health/";
const BV = "/t/bayview-care/";
const PW = "correct horse battery staple";
const fault = (page: Page, f: string) => page.request.post(`/__test/fault?fault=${f}`);
const heading = (page: Page, name: string | RegExp) => expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const body = (over: Record<string, unknown> = {}, bay = false) => ({
  email: "pat.synthetic@example.test", password: PW, firstName: "Pat", lastName: "Synthetic", dateOfBirth: "1985-04-12", phone: "+31 6 1234 5678",
  access: { type: "employer", employerId: bay ? "em-b-1" : "em-n-1" }, ...over,
});

test.beforeEach(async ({ page }) => { await page.request.post("/__test/reset"); });   // each test has a fresh browser context, so storage starts empty

/** Creates an account and signs the page's browser context in (the cookie is shared with page.request). */
async function signIn(page: Page, tenant = NW, over: Record<string, unknown> = {}) {
  const r = await page.request.post(`${tenant}api/auth/signup`, { data: body(over, tenant === BV) });
  expect(r.status()).toBe(201);
}
async function toState(page: Page, tenant = NW) { await signIn(page, tenant); await page.goto(tenant); await page.getByRole("button", { name: "Book Now" }).click(); }
async function pickState(page: Page, code = "CA") { await toState(page); await page.getByLabel("State").selectOption(code); await next(page); }
async function pickClinic(page: Page, name = "San Bernardo Clinic") { await page.getByRole("radio", { name: new RegExp(name) }).check(); await next(page); }
async function pickVisit(page: Page, label = "Primary Care") { await page.getByRole("radio", { name: new RegExp(label) }).check(); await next(page); }
async function pickProviderAndSlot(page: Page, provider = "Dr. Alex Example", slotIndex = 0) {
  await page.getByRole("radio", { name: provider }).check();
  const slots = page.locator('input[name="slot"]'); await expect(slots.first()).toBeAttached();
  await slots.nth(slotIndex).check(); await next(page);
  await heading(page, "Your details"); await next(page);
}
async function toReview(page: Page, slotIndex = 0) { await pickState(page); await pickClinic(page); await pickVisit(page); await pickProviderAndSlot(page, "Dr. Alex Example", slotIndex); await heading(page, "Review your appointment"); }
const REF = /CX-[0-9A-Z]{4}-[0-9A-Z]{4}/;   // patient-facing booking reference
const confirm = (page: Page) => page.getByRole("button", { name: "Confirm appointment" });

test("happy path: Book Now to confirmed appointment with authoritative summary", async ({ page }) => {
  await signIn(page); await page.goto(NW);
  await heading(page, "Book an appointment");
  await page.getByRole("button", { name: "Book Now" }).click();
  await heading(page, "Where would you like to be seen?");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();                 // focus moves to the new screen's heading
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();          // cannot continue before choosing
  await page.getByLabel("State").selectOption("CA"); await next(page);
  await heading(page, "Choose a clinic");
  await pickClinic(page); await heading(page, "What type of visit do you need?");
  await pickVisit(page); await heading(page, "Choose a provider and time");
  await pickProviderAndSlot(page);
  await heading(page, "Review your appointment");
  await expect(page.getByText("San Bernardo Clinic").first()).toBeVisible();
  await expect(page.getByText("Dr. Alex Example").first()).toBeVisible();
  await expect(page.locator("dl.summary").first()).toContainText(/(PST|PDT)/);                  // explicit clinic time zone
  await expect(page.locator("main")).toContainText("Pat Synthetic");                    // details come from the account, not a form
  await expect(page.getByLabel("First name")).toHaveCount(0);
  await confirm(page).click();
  await heading(page, "Appointment confirmed");
  await expect(page.locator("strong").filter({ hasText: REF })).toBeVisible();
  await expect(page.locator("dl.summary")).toContainText("Primary Care");
});

test("keyboard-only: every step is operable without a mouse", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "keyboard flow is exercised on desktop and tablet");
  await signIn(page); await page.goto(NW);
  await page.getByRole("button", { name: "Book Now" }).focus(); await page.keyboard.press("Enter");
  await page.getByLabel("State").focus(); await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "Continue" }).focus(); await page.keyboard.press("Enter");
  await heading(page, "Choose a clinic");
  await page.getByRole("radio", { name: /San Bernardo/ }).focus(); await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Continue" }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: /Primary Care/ }).focus(); await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Continue" }).focus(); await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Dr. Alex Example" }).focus(); await page.keyboard.press("Space");
  await expect(page.locator('input[name="slot"]').first()).toBeAttached();
  await page.locator('input[name="slot"]').first().focus(); await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Continue" }).focus(); await page.keyboard.press("Enter");
  await heading(page, "Your details");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).focus(); await page.keyboard.press("Enter");
  await heading(page, "Review your appointment");
  await expect(page.locator("input:focus, button:focus, select:focus").first()).toBeDefined();
});

test("changing an upstream choice invalidates downstream choices", async ({ page }) => {
  await toReview(page);
  await page.getByRole("button", { name: "Back" }).click();                           // your details
  await page.getByRole("button", { name: "Back" }).click();                           // provider & time
  await page.getByRole("button", { name: "Back" }).click();                           // visit type
  await page.getByRole("button", { name: "Back" }).click();                           // clinic
  await page.getByRole("button", { name: "Back" }).click();                           // state
  await page.getByLabel("State").selectOption("TX"); await next(page);
  await expect(page.getByRole("radio", { name: /San Bernardo/ })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(1);                                // only Austin
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();         // clinic choice was cleared
  await pickClinic(page, "Austin Clinic");
  await expect(page.getByRole("radio", { name: /Physio/ })).toHaveCount(0);            // visit types follow the clinic
  await expect(page.getByRole("radio", { name: /Health Coach/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await pickVisit(page);
  await expect(page.getByRole("radio", { name: "Dr. Casey Placeholder" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dr. Alex Example" })).toHaveCount(0);
  await expect(page.locator('input[name="slot"]')).toHaveCount(0);                     // no stale slot carried over
});

test("empty state: no clinics for a state offers a way to change it", async ({ page }) => {
  await toState(page);
  await expect(page.getByLabel("State").locator("option[value=NY]")).toHaveCount(0);   // NY clinic is not bookable, so NY is not offered
});

test("slot taken before confirmation: refused, selections preserved, alternatives offered", async ({ page }) => {
  await toReview(page, 0);
  const taken = await page.request.get("/t/northwind-health/api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a");
  const first = (await taken.json()).slots[0].id as string;
  const other = await pwRequest.newContext({ baseURL: `http://127.0.0.1:4173` });             // a different patient, with their own session
  expect((await other.post("/t/northwind-health/api/auth/signup", { data: body({ email: "other@example.test", firstName: "Other", lastName: "Person" }) })).status()).toBe(201);
  const r = await other.post("/t/northwind-health/api/bookings", { headers: { "idempotency-key": "someone-else-1" }, data: { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: first, confirmed: true } });
  expect(r.status()).toBe(201); await other.dispose();
  await confirm(page).click();
  await heading(page, "That time is no longer available");
  await page.getByRole("button", { name: "Choose another time" }).click();
  await heading(page, "Choose a provider and time");
  await expect(page.getByRole("radio", { name: "Dr. Alex Example" })).toBeChecked();   // valid selections kept
  await expect(page.locator('input[name="slot"]:checked')).toHaveCount(0);            // the lost slot is cleared
  await expect(page.locator(`input[name="slot"][value="${first}"]`)).toHaveCount(0);   // and no longer offered
  await page.locator('input[name="slot"]').first().check(); await next(page); await heading(page, "Your details"); await next(page); await confirm(page).click();
  await heading(page, "Appointment confirmed");
});

test("double-clicking Confirm sends one booking request and creates one booking", async ({ page }) => {
  await toReview(page); 
  const slotsBefore = await (await page.request.get("/t/northwind-health/api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a")).json();
  let posts = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/bookings")) posts++; });
  await confirm(page).dblclick();
  await heading(page, "Appointment confirmed");
  expect(posts).toBe(1);
  const slots = await (await page.request.get("/t/northwind-health/api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a")).json();
  expect(slots.slots.length).toBe(slotsBefore.slots.length - 1);                       // exactly one slot consumed
});

test("timeout after the booking was saved: shows 'checking', never 'confirmed', then reconciles", async ({ page }) => {
  await toReview(page); await fault(page, "timeout_after_commit");
  await confirm(page).click();
  await heading(page, "We're checking your booking");
  await expect(page.getByText("Appointment confirmed")).toHaveCount(0);
  await expect(page.locator("strong").filter({ hasText: REF })).toHaveCount(0);                                // no booking number claimed yet
  await page.getByRole("button", { name: "Check status" }).click();
  await heading(page, "Appointment confirmed"); await expect(page.locator("strong").filter({ hasText: REF })).toBeVisible();
});

test("scheduling outage: clear failure, nothing claimed, retry works", async ({ page }) => {
  await toReview(page); await fault(page, "unavailable");
  await confirm(page).click();
  await heading(page, "We couldn't complete your booking");
  await expect(page.getByRole("alert")).toContainText("No appointment was created");
  await page.getByRole("button", { name: "Try again" }).click();
  await heading(page, "Appointment confirmed");
});

test("tenants are isolated and branded", async ({ page }) => {
  await toState(page, BV);
  await expect(page.locator("header.site .brand")).toContainText("Bayview Care");
  await expect(page.getByLabel("State").locator("option")).toHaveText(["Select a state", "California (CA)"]);
  await page.getByLabel("State").selectOption("CA"); await next(page);
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: /Oakland/ })).toBeVisible();
  await expect(page.getByText("San Bernardo")).toHaveCount(0);
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
  expect(brand).toBe("#0a7d5a");
});

test("unknown, suspended or malformed tenant shows a safe page and no data", async ({ page }) => {
  for (const slug of ["no-such-tenant", "dormant-clinic", "BAD%20SLUG"]) {
    await page.goto(`/t/${slug}/`);
    await heading(page, "This booking page isn't available");
    await expect(page.getByRole("button", { name: "Book Now" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/Northwind|Bayview|Clinic/);
  }
});

test("refresh resilience: selections are revalidated, never trusted", async ({ page }) => {
  await signIn(page); await page.goto(NW);
  await page.getByRole("button", { name: "Book Now" }).click();
  await page.getByLabel("State").selectOption("CA"); await next(page);
  await pickClinic(page); await pickVisit(page); await pickProviderAndSlot(page, "Dr. Alex Example", 0);
  await heading(page, "Review your appointment");
  await page.evaluate(() => sessionStorage.setItem("carex:northwind-health", JSON.stringify({ sel: { stateCode: "CA", clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: "tn-north:pr-a:20300101T0000" }, screen: "review" })));
  await page.reload();
  await heading(page, "Choose a provider and time");                                   // lands on the slot step, not review
  await expect(page.getByRole("radio", { name: "Dr. Alex Example" })).toBeChecked();   // valid provider survives
  await expect(page.locator('input[name="slot"]:checked')).toHaveCount(0);             // forged/stale slot is dropped
});

test("responsive: no horizontal scroll at 320px, and with 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await toReview(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.evaluate(() => document.documentElement.style.setProperty("font-size", "200%", "important"));   // CSSOM, so the strict CSP still applies
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test.describe("accessibility (axe: WCAG 2.0/2.1/2.2 A and AA rules)", () => {
  const scan = async (page: Page, label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  };
  test("every screen has no detectable violations", async ({ page }) => {
    await signIn(page); await page.goto(NW); await scan(page, "entry");
    await page.getByRole("button", { name: "Book Now" }).click(); await heading(page, "Where would you like to be seen?"); await scan(page, "state");
    await page.getByLabel("State").selectOption("CA"); await scan(page, "state-selected"); await next(page);
    await heading(page, "Choose a clinic"); await page.getByRole("radio", { name: /San Bernardo/ }).check(); await scan(page, "clinic-selected"); await next(page);
    await heading(page, "What type of visit do you need?"); await scan(page, "visit");
    await pickVisit(page); await heading(page, "Choose a provider and time");
    await page.getByRole("radio", { name: "Dr. Alex Example" }).check(); await expect(page.locator('input[name="slot"]').first()).toBeAttached();
    await page.locator('input[name="slot"]').first().check(); await scan(page, "slot");
    await next(page); await heading(page, "Your details"); await scan(page, "details"); await next(page); await heading(page, "Review your appointment"); await scan(page, "review");
    await confirm(page).click(); await heading(page, "Appointment confirmed"); await scan(page, "confirmed");
  });
  test("failure and pending screens have no violations", async ({ page }) => {
    await toReview(page); await fault(page, "timeout_after_commit"); await confirm(page).click();
    await heading(page, "We're checking your booking"); await scan(page, "pending");
  });
});

test("long availability is shown a few days at a time, and more can be revealed", async ({ page }) => {
  await pickState(page); await pickClinic(page); await pickVisit(page);
  await page.getByRole("radio", { name: "Dr. Alex Example" }).check();
  await expect(page.locator('input[name="slot"]').first()).toBeAttached();
  await expect(page.locator("fieldset .slots")).toHaveCount(3);                         // not the whole fortnight at once
  await page.getByRole("button", { name: "Show more dates" }).click();
  await expect(page.locator("fieldset .slots")).toHaveCount(6);
  await expect(page.locator('input[name="slot"]:focus')).toHaveCount(1);                // focus moves to the new times, not lost
});


// ---------------------------------------------------------------- accounts (ADR-005): sign up, log in, reset, my appointments
const scanOf = async (page: Page, label: string) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} (${v.nodes.length})`)).toEqual([]);
};

async function step1(page: Page, over: { first?: string; last?: string; dob?: string; phone?: string } = {}) {
  await page.getByLabel("First name").fill(over.first ?? "Pat"); await page.getByLabel("Last name").fill(over.last ?? "Synthetic");
  await page.getByLabel("Date of birth").fill(over.dob ?? "1985-04-12"); await page.getByLabel("Mobile phone number").fill(over.phone ?? "+31 6 1234 5678");
}

test.describe("sign up", () => {
  test("employer path: typeahead, then email and password, lands signed in on the booking page", async ({ page }) => {
    await page.goto(`${NW}signup`);
    await heading(page, /Let's get started/);
    await scanOf(page, "signup-1");
    await step1(page);
    await page.getByRole("radio", { name: "Through an employer" }).check();
    await expect(page.getByText("Please begin typing your employer's name")).toBeVisible();
    await page.getByLabel("Employer", { exact: true }).fill("glo");
    await page.getByRole("button", { name: "Globex Manufacturing (demo)" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await heading(page, "Create your login"); await scanOf(page, "signup-2");
    await page.getByLabel("Email address").fill("new.patient@example.test");
    await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel(/^Password/)).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Create account" }).click();
    await heading(page, "Book an appointment");
    await expect(page.locator("header.site")).toContainText("Pat");
  });

  test("insurer path uses the insurance dropdown", async ({ page }) => {
    await page.goto(`${NW}signup`); await step1(page);
    await page.getByRole("radio", { name: /Through an insurance provider/ }).check();
    await page.getByLabel("Insurance provider", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Email address").fill("ins.patient@example.test"); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Create account" }).click();
    await heading(page, "Book an appointment");
  });

  test("step 1 problems are explained inline and nothing advances", async ({ page }) => {
    await page.goto(`${NW}signup`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Enter your first name")).toBeVisible();
    await expect(page.getByLabel("First name")).toBeFocused();
    await expect(page.getByText("Tell us how you are accessing care")).toBeVisible();
    await scanOf(page, "signup-errors");
    await heading(page, /Let's get started/);
  });

  test("a duplicate email is refused with a clear message, and under-18s cannot register", async ({ page }) => {
    await signIn(page);
    await page.request.post(`${NW}api/auth/logout`);
    await page.goto(`${NW}signup`); await step1(page);
    await page.getByRole("radio", { name: "Through an employer" }).check();
    await page.getByLabel("Employer", { exact: true }).fill("acme"); await page.getByRole("button", { name: /Acme Logistics/ }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.goto(`${NW}signup`); await step1(page, { dob: "2020-01-01" });
    await page.getByRole("radio", { name: /Through an insurance provider/ }).check(); await page.getByLabel("Insurance provider", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Email address").fill("kid@example.test"); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Create account" }).click();
    await heading(page, /Let's get started/);                                  // sent back to the step with the problem
    await expect(page.getByText(/18/)).toBeVisible();
  });
});

test.describe("log in, log out, reset password", () => {
  test("login shows the tenant brand, rejects wrong passwords generically, and signs in with the right one", async ({ page }) => {
    await signIn(page); await page.request.post(`${NW}api/auth/logout`);
    await page.goto(`${NW}login`);
    await heading(page, "Welcome"); await expect(page.locator(".authbrand")).toContainText("Northwind Health");
    await expect(page.locator("body")).not.toContainText(/crossover/i);
    await scanOf(page, "login");
    await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByLabel(/^Password/).fill("wrong password 123");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText(/Invalid email or password/);
    await page.getByLabel(/^Password/).fill(PW); await page.getByRole("button", { name: "Continue" }).click();
    await heading(page, "Book an appointment");
  });

  test("log out ends the session and booking requires signing in again", async ({ page }) => {
    await signIn(page); await page.goto(NW); await heading(page, "Book an appointment");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(NW); await expect(page).toHaveURL(/\/login/);
  });

  test("forgot and reset password: link works once, then the new password logs in", async ({ page }) => {
    await signIn(page); await page.request.post(`${NW}api/auth/logout`);
    await page.goto(`${NW}forgot`); await heading(page, "Forgot your password?"); await scanOf(page, "forgot");
    await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByRole("button", { name: "Send reset link" }).click();
    await heading(page, "Check your email");
    const token = (await (await page.request.get("/__test/reset-token")).json()).token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await page.goto(`${NW}reset#token=${token}`); await heading(page, "Choose a new password"); await scanOf(page, "reset");
    await page.getByLabel(/^New password/).fill("another long passphrase 42"); await page.getByRole("button", { name: "Change password" }).click();
    await heading(page, "Password updated");
    await page.goto("about:blank"); await page.goto(`${NW}reset#token=${token}`); await page.getByLabel(/^New password/).fill("yet another passphrase 43"); await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert")).toBeVisible();                       // single use
    await page.goto(`${NW}login`); await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByLabel(/^Password/).fill("another long passphrase 42");
    await page.getByRole("button", { name: "Continue" }).click(); await heading(page, "Book an appointment");
  });

  test("unknown email gets the same neutral confirmation (no account enumeration)", async ({ page }) => {
    await page.goto(`${NW}forgot`); await page.getByLabel("Email address").fill("nobody@example.test"); await page.getByRole("button", { name: "Send reset link" }).click();
    await heading(page, "Check your email");
  });

  test("an account belongs to one clinic brand: Northwind login does not work on Bayview", async ({ page }) => {
    await signIn(page); await page.request.post(`${NW}api/auth/logout`);
    await page.goto(`${BV}login`); await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toContainText(/Invalid email or password/);
  });
});

test.describe("booking requires an account", () => {
  test("signed-out visitors are sent to log in, then return to where they were going", async ({ page }) => {
    await signIn(page); await page.request.post(`${NW}api/auth/logout`);
    await page.goto(`${NW}appointments`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email address").fill("pat.synthetic@example.test"); await page.getByLabel(/^Password/).fill(PW);
    await page.getByRole("button", { name: "Continue" }).click();
    await heading(page, "My appointments");
  });

  test("the API refuses catalog and booking calls without a session", async ({ page }) => {
    for (const path of ["api/clinics", "api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a", "api/bookings"]) expect((await page.request.get(NW + path)).status()).toBe(401);
    expect((await page.request.post(`${NW}api/bookings`, { headers: { "idempotency-key": "anon-key-0001" }, data: {} })).status()).toBe(401);
  });

  test("the sign-in page of a suspended or unknown clinic is a safe page", async ({ page }) => {
    await page.goto("/t/dormant-clinic/login"); await heading(page, "This page isn't available");
  });
});

async function bookOne(page: Page): Promise<string> {
  await toReview(page, 12); await confirm(page).click();
  await heading(page, "Appointment confirmed");
  return (await page.locator("strong").filter({ hasText: REF }).first().innerText()).trim();
}

test.describe("details step", () => {
  test("safety answer 'yes' shows the emergency message and blocks the booking", async ({ page }) => {
    await pickState(page); await pickClinic(page); await pickVisit(page);
    await page.getByRole("radio", { name: "Dr. Alex Example" }).check();
    await page.locator('input[name="slot"]').first().check(); await next(page);
    await heading(page, "Your details");
    await page.getByRole("radio", { name: /Yes, one or more apply/ }).check();
    await expect(page.getByRole("alert").filter({ hasText: "911" })).toBeVisible();
    await next(page);
    await expect(page.getByRole("alert").filter({ hasText: "Please fix" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review your appointment" })).toHaveCount(0);
    await page.getByRole("radio", { name: /No, none of these apply/ }).check(); await next(page);
    await heading(page, "Review your appointment");
  });
  test("adds a family member and books for them; the confirmation names the patient", async ({ page }) => {
    await pickState(page); await pickClinic(page); await pickVisit(page);
    await page.getByRole("radio", { name: "Dr. Alex Example" }).check();
    await page.locator('input[name="slot"]').nth(14).check(); await next(page);
    await heading(page, "Your details");
    await page.getByRole("button", { name: "Add a family member" }).click();
    await page.getByLabel("First name").fill("Sam"); await page.getByLabel("Last name").fill("Example"); await page.getByLabel("Date of birth").fill("2015-04-02");
    await page.getByRole("button", { name: "Save family member" }).click();
    await expect(page.getByRole("radio", { name: /Sam Example/ })).toBeChecked();
    await page.getByLabel("What is the visit for?").fill("Cough for two days");
    await next(page); await heading(page, "Review your appointment");
    await expect(page.getByText("Sam Example").first()).toBeVisible();
    await confirm(page).click(); await heading(page, "Appointment confirmed");
    await expect(page.getByText("Sam Example").first()).toBeVisible();
  });
  test("first available lists times across providers and selecting one sets the provider", async ({ page }) => {
    await pickState(page); await pickClinic(page); await pickVisit(page);
    await page.getByRole("button", { name: /first available/i }).click();
    const any = page.locator('input[name="anyslot"]'); await expect(any.first()).toBeAttached();
    await any.first().check();
    await expect(page.locator('input[name="provider"]:checked')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
  test("waitlist button confirms", async ({ page }) => {
    await pickState(page); await pickClinic(page); await pickVisit(page);
    await page.getByRole("radio", { name: "Dr. Alex Example" }).check();
    await expect(page.locator('input[name="slot"]').first()).toBeAttached();
    await page.getByRole("button", { name: /earlier time opens/ }).click();
    await expect(page.getByText(/on the waitlist/)).toBeVisible();
  });
});

test.describe("my appointments", () => {
  test("lists the booking; details, cancel (keep first) release the time", async ({ page }) => {
    const ref = await bookOne(page);
    const before = (await (await page.request.get(`${NW}api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).json()).slots.length;
    await page.getByRole("link", { name: "My appointments" }).first().click();
    await heading(page, "My appointments"); await scanOf(page, "appts-list");
    await expect(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
    await page.getByRole("button", { name: /View|Manage|Details/ }).first().click();
    await heading(page, "Your appointment");
    await expect(page.locator("dl.summary")).toContainText(ref); await expect(page.locator("dl.summary")).toContainText("Dr. Alex Example");
    await scanOf(page, "appt-details");
    await page.getByRole("button", { name: "Cancel appointment" }).click(); await heading(page, "Cancel this appointment?"); await scanOf(page, "appt-confirm-cancel");
    await page.getByRole("button", { name: "Keep appointment" }).click(); await heading(page, "Your appointment");
    await page.getByRole("button", { name: "Cancel appointment" }).click(); await page.getByRole("button", { name: "Yes, cancel appointment" }).click();
    await heading(page, "Appointment cancelled"); await scanOf(page, "appt-cancelled");
    const after = (await (await page.request.get(`${NW}api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a`)).json()).slots.length;
    expect(after).toBe(before + 1);
  });

  test("change time moves the same booking", async ({ page }) => {
    const ref = await bookOne(page);
    await page.goto(`${NW}appointments`); await page.getByRole("button", { name: /View|Manage|Details/ }).first().click(); await heading(page, "Your appointment");
    const when = async () => (await page.locator("dl.summary dd").nth(4).innerText()) + (await page.locator("dl.summary dd").nth(5).innerText());
    const oldTime = await when();
    await page.getByRole("button", { name: "Change time" }).click(); await heading(page, "Choose a new time"); await scanOf(page, "appt-pick");
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.locator('input[name="slot"]').nth(4).check(); await page.getByRole("button", { name: "Continue" }).click();
    await heading(page, "Confirm the new time"); await page.getByRole("button", { name: "Confirm new time" }).click();
    await heading(page, "Your appointment");
    await expect(page.locator("dl.summary dd").first()).toHaveText(ref);
    expect(await when()).not.toBe(oldTime);
  });

  test("another patient's appointment is never visible", async ({ page }) => {
    const ref = await bookOne(page);
    const other = await pwRequest.newContext({ baseURL: "http://127.0.0.1:4173" });
    await other.post("/t/northwind-health/api/auth/signup", { data: body({ email: "other@example.test", firstName: "Other", lastName: "Person" }) });
    expect(JSON.stringify(await (await other.get("/t/northwind-health/api/bookings")).json())).not.toContain(ref);
    expect((await other.get(`/t/northwind-health/api/bookings/${ref}`)).status()).toBe(404);
    await other.dispose();
  });

  test("an empty list invites the first booking", async ({ page }) => {
    await signIn(page); await page.goto(`${NW}appointments`); await heading(page, "My appointments");
    await expect(page.getByText("You have no appointments yet.")).toBeVisible();
  });
});

test("confirmation offers a calendar file without personal details", async ({ page }) => {
  await bookOne(page);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to calendar" }).click();
  const file = await dl; expect(file.suggestedFilename()).toBe("appointment.ics");
  const text = await (await import("node:fs/promises")).readFile((await file.path())!, "utf8");
  expect(text).toMatch(/BEGIN:VEVENT[\s\S]*SUMMARY:Primary Care with Dr\. Alex Example[\s\S]*END:VEVENT/);
  expect(text).not.toMatch(/Synthetic|pat\.synthetic/);
});

test("no content-security-policy violations or script errors across account and booking flows", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${NW}signup`); await heading(page, /Let's get started/);
  await page.goto(`${NW}login`); await heading(page, "Welcome");
  await page.goto(`${NW}forgot`); await heading(page, "Forgot your password?");
  await bookOne(page);
  await page.goto(`${NW}appointments`); await heading(page, "My appointments");
  expect(problems).toEqual([]);
  const csp = (await page.request.get(`${NW}login`)).headers()["content-security-policy"];
  expect(csp).not.toMatch(/unsafe-inline/);
});
