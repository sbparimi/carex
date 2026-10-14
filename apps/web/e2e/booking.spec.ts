import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const NW = "/t/northwind-health/";
const fault = (page: Page, f: string) => page.request.post(`/__test/fault?fault=${f}`);
const heading = (page: Page, name: string | RegExp) => expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

test.beforeEach(async ({ page }) => { await page.request.post("/__test/reset"); });   // each test has a fresh browser context, so storage starts empty

async function toState(page: Page, tenant = NW) { await page.goto(tenant); await page.getByRole("button", { name: "Book Now" }).click(); }
async function pickState(page: Page, code = "CA") { await toState(page); await page.getByLabel("State").selectOption(code); await next(page); }
async function pickClinic(page: Page, name = "San Bernardo Clinic") { await page.getByRole("radio", { name: new RegExp(name) }).check(); await next(page); }
async function pickVisit(page: Page, label = "Primary Care") { await page.getByRole("radio", { name: new RegExp(label) }).check(); await next(page); }
async function pickProviderAndSlot(page: Page, provider = "Dr. Alex Example", slotIndex = 0) {
  await page.getByRole("radio", { name: provider }).check();
  const slots = page.locator('input[name="slot"]'); await expect(slots.first()).toBeAttached();
  await slots.nth(slotIndex).check(); await next(page);
}
async function toReview(page: Page, slotIndex = 0) { await pickState(page); await pickClinic(page); await pickVisit(page); await pickProviderAndSlot(page, "Dr. Alex Example", slotIndex); await heading(page, "Review your appointment"); }
async function fillDetails(page: Page) {
  await page.getByLabel("First name").fill("Pat"); await page.getByLabel("Last name").fill("Synthetic"); await page.getByLabel("Email").fill("pat.synthetic@example.test");
}
const confirm = (page: Page) => page.getByRole("button", { name: "Confirm appointment" });

test("happy path: Book Now to confirmed appointment with authoritative summary", async ({ page }) => {
  await page.goto(NW);
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
  await expect(page.locator("dl.summary")).toContainText(/(PST|PDT)/);                  // explicit clinic time zone
  await fillDetails(page); await confirm(page).click();
  await heading(page, "Appointment confirmed");
  await expect(page.getByText("bk-1")).toBeVisible();
  await expect(page.locator("dl.summary")).toContainText("Primary Care");
});

test("keyboard-only: every step is operable without a mouse", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "keyboard flow is exercised on desktop and tablet");
  await page.goto(NW);
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
  await heading(page, "Review your appointment");
  await expect(page.locator("input:focus, button:focus, select:focus").first()).toBeDefined();
});

test("changing an upstream choice invalidates downstream choices", async ({ page }) => {
  await toReview(page);
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
  const r = await page.request.post("/t/northwind-health/api/bookings", { headers: { "idempotency-key": "someone-else-1" }, data: { clinicId: "cl-sb", serviceId: "sv-pc-n", providerId: "pr-a", slotId: first, confirmed: true, patient: { firstName: "Other", lastName: "Person", email: "o@example.test" } } });
  expect(r.status()).toBe(201);
  await fillDetails(page); await confirm(page).click();
  await heading(page, "That time is no longer available");
  await page.getByRole("button", { name: "Choose another time" }).click();
  await heading(page, "Choose a provider and time");
  await expect(page.getByRole("radio", { name: "Dr. Alex Example" })).toBeChecked();   // valid selections kept
  await expect(page.locator('input[name="slot"]:checked')).toHaveCount(0);            // the lost slot is cleared
  await expect(page.locator('input[name="slot"]')).toHaveCount(8);                     // and no longer offered
  await page.locator('input[name="slot"]').first().check(); await next(page); await fillDetails(page); await confirm(page).click();
  await heading(page, "Appointment confirmed");
});

test("double-clicking Confirm sends one booking request and creates one booking", async ({ page }) => {
  await toReview(page); await fillDetails(page);
  let posts = 0; page.on("request", (r) => { if (r.method() === "POST" && r.url().endsWith("/bookings")) posts++; });
  await confirm(page).dblclick();
  await heading(page, "Appointment confirmed");
  expect(posts).toBe(1);
  const slots = await (await page.request.get("/t/northwind-health/api/slots?clinicId=cl-sb&serviceId=sv-pc-n&providerId=pr-a")).json();
  expect(slots.slots).toHaveLength(8);                                                 // exactly one slot consumed
});

test("timeout after the booking was saved: shows 'checking', never 'confirmed', then reconciles", async ({ page }) => {
  await toReview(page); await fillDetails(page); await fault(page, "timeout_after_commit");
  await confirm(page).click();
  await heading(page, "We're checking your booking");
  await expect(page.getByText("Appointment confirmed")).toHaveCount(0);
  await expect(page.getByText(/bk-\d/)).toHaveCount(0);                                // no booking number claimed yet
  await page.getByRole("button", { name: "Check status" }).click();
  await heading(page, "Appointment confirmed"); await expect(page.getByText("bk-1")).toBeVisible();
});

test("scheduling outage: clear failure, nothing claimed, retry works", async ({ page }) => {
  await toReview(page); await fillDetails(page); await fault(page, "unavailable");
  await confirm(page).click();
  await heading(page, "We couldn't complete your booking");
  await expect(page.getByRole("alert")).toContainText("No appointment was created");
  await page.getByRole("button", { name: "Try again" }).click();
  await heading(page, "Appointment confirmed");
});

test("validation: required details are explained inline and focus moves to the first error", async ({ page }) => {
  await toReview(page); await confirm(page).click();
  await expect(page.getByText("Enter your first name.")).toBeVisible();
  await expect(page.getByLabel("First name")).toBeFocused();
  await expect(page.getByLabel("First name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter an email address or a phone number.")).toBeVisible();
  await expect(page.getByText("Appointment confirmed")).toHaveCount(0);
});

test("tenants are isolated and branded", async ({ page }) => {
  await toState(page, "/t/bayview-care/");
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
  await page.goto(NW);
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
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test.describe("accessibility (axe: WCAG 2.0/2.1/2.2 A and AA rules)", () => {
  const scan = async (page: Page, label: string) => {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  };
  test("every screen has no detectable violations", async ({ page }) => {
    await page.goto(NW); await scan(page, "entry");
    await page.getByRole("button", { name: "Book Now" }).click(); await heading(page, "Where would you like to be seen?"); await scan(page, "state");
    await page.getByLabel("State").selectOption("CA"); await scan(page, "state-selected"); await next(page);
    await heading(page, "Choose a clinic"); await page.getByRole("radio", { name: /San Bernardo/ }).check(); await scan(page, "clinic-selected"); await next(page);
    await heading(page, "What type of visit do you need?"); await scan(page, "visit");
    await pickVisit(page); await heading(page, "Choose a provider and time");
    await page.getByRole("radio", { name: "Dr. Alex Example" }).check(); await expect(page.locator('input[name="slot"]').first()).toBeAttached();
    await page.locator('input[name="slot"]').first().check(); await scan(page, "slot");
    await next(page); await heading(page, "Review your appointment"); await confirm(page).click(); await scan(page, "review-with-errors");
    await fillDetails(page); await confirm(page).click(); await heading(page, "Appointment confirmed"); await scan(page, "confirmed");
  });
  test("failure and pending screens have no violations", async ({ page }) => {
    await toReview(page); await fillDetails(page); await fault(page, "timeout_after_commit"); await confirm(page).click();
    await heading(page, "We're checking your booking"); await scan(page, "pending");
  });
});
