# ADR-006: Visual standard for account pages

Status: accepted, built. Reference: owner-supplied sign-in screenshot (patterns only; no third-party name, logo or colours are used).

- One centered white card (max 28rem, large radius, soft shadow) on a calm light-grey surface; full-bleed on phones.
- Tenant lockup on top of the card: a CareX plus-mark in the tenant colour and the tenant display name.
- Outlined inputs, 3.5rem tall, with a floating label that sits on the border when focused or filled. The label is always a real `<label for>`; required fields show `*`.
- Password field has an eye icon button (accessible name "Show password" / "Hide password", `aria-pressed`).
- Primary action is a full-width pill in the tenant colour; links are bold, tenant coloured, left aligned.
- Pill buttons and rounded cards apply across the booking pages too, so the product reads as one system.
- Accessibility is unchanged: axe (WCAG 2.2 AA) passes on every screen at 1440, 768 and 390 px; keyboard focus is always visible.
