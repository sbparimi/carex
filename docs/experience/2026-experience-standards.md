# CareX experience standards — 2026

## Design intent
CareX is a healthcare access and practice-operations product. The interface must reduce uncertainty, prevent avoidable mistakes, communicate status clearly and remain usable on mobile, keyboard-only and assistive-technology workflows. Visual polish must never obscure clinical or administrative meaning.

## Experience principles
1. Task-first: each screen has one primary task, a clear heading and a visible next step.
2. Progressive disclosure: collect only information required for the current decision; explain why sensitive fields are needed.
3. Predictable navigation: stable patient, staff and administrator navigation; preserve context when users move between a list and a record.
4. Visible system status: distinguish saved, pending, failed, cancelled and completed states. Never imply a booking or update succeeded before the server confirms it.
5. Error prevention and recovery: validate near the field, preserve safe user input after recoverable errors, explain the correction and avoid blame.
6. Accessible by default: WCAG 2.2 AA target; semantic landmarks, labels, fieldsets, keyboard access, visible focus, reflow, contrast, reduced motion and screen-reader announcements.
7. Privacy by design: avoid PHI in page titles, URLs, analytics, error messages, logs and browser storage. Do not add third-party trackers to authenticated clinical screens without privacy/security approval.
8. Mobile parity: no feature may require hover; touch targets should be at least 44×44 CSS px; primary actions remain reachable without obscuring content.
9. Trustworthy language: plain language, explicit time zone, clinic/provider identity, cancellation policy and next-step expectations.
10. No dark patterns: no preselected consent, deceptive urgency, hidden fees or confusing destructive actions.

## Visual system
- Use a restrained, clinic-neutral palette with tenant brand colour as an accent, not as the sole carrier of status.
- Use consistent spacing, typography hierarchy, card radii, borders and elevation. Avoid excessive gradients, decorative animation and dense dashboards.
- Maintain readable line lengths and responsive layouts; preserve the server-rendered/no-JavaScript architecture.
- Use distinct visual treatments and text labels for success, warning, error and informational states.
- Support reduced motion and increased contrast preferences.

## Booking journey acceptance criteria
- The patient can identify clinic, visit type, provider choice, date/time and local time zone at every relevant step.
- The selected slot and patient identity are repeated on the review step before confirmation.
- Changing an upstream selection invalidates dependent selections and communicates why.
- A confirmed booking displays a durable reference and clear management/cancellation route.
- A timeout or network failure never produces a false success state; explain how to safely check the appointment before retrying.
- Empty, loading, unavailable, validation-error and service-error states are designed and tested.

## Staff workflow acceptance criteria
- Schedule views are scannable, keyboard-operable and usable at common laptop/tablet widths.
- Patient identity is prominent enough to reduce wrong-patient risk, while sensitive details remain masked until required.
- Destructive actions require clear context and confirmation; completed actions show an audit-relevant status.
- Filters and pagination preserve state; empty states explain how to proceed.
- Permissions are reflected in navigation and enforced server-side.

## Verification
- Automated: axe-core/WCAG checks where compatible, template tests, responsive viewport checks, keyboard navigation smoke tests and form-label checks.
- Manual: NVDA + Firefox/Chrome and VoiceOver + Safari; keyboard-only; 200% zoom; 320 CSS px reflow; high contrast; reduced motion.
- Usability: task-based tests with representative patients, front-desk staff and clinicians. Record task completion, errors, recovery and comprehension; do not invent results.
- Clinical safety: validate wrong-patient, wrong-provider, wrong-time-zone, duplicate booking and failed-save scenarios.
