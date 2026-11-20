# CareX cancellation implementation evidence — Section 04

**Inspected branch head:** bc904505d23f26b2e1ee14facc21dfdd83b24819  
**Files inspected:** carex/booking.py and carex/scheduling.py  
**Scope:** Checked-in source only. This is not runtime or deployment evidence.

## What the source currently does

1. BookingService defaults change_notice_minutes to 120. Its managed appointment projection uses this value to calculate the can_change flag.
2. Scheduling defaults min_change_notice_minutes to 120.
3. Scheduling._assert_change_allowed rejects a change when the appointment start is less than min_notice minutes after the current instant.
4. Scheduling.cancel invokes that guard for actors other than staff and system. The patient cancellation path calls Scheduling.cancel with by="patient".
5. Separately, Scheduling.cancel reads tenants.late_cancel_hours, defaulting to 24 when unset. It sets the appointment late_cancel flag when the appointment start is less than that number of hours away.
6. The 24-hour late_cancel calculation is a classification/recording flag. It does not itself reject the cancellation.
7. Staff and system cancellation bypass the online change-window guard in Scheduling.cancel. Route-level authentication and authorization still need contract and implementation review.

## Critical distinction

The current checked-in code does not prove a rule that patient cancellation is denied within 24 hours. It currently has a 120-minute online change restriction and a separate 24-hour late-cancellation flag. The synthetic CAREX-CHANGE-030-CANCEL-24H proposal would change the patient cancellation gate from the current 120-minute behaviour to a 24-hour denial threshold. It is not an existing feature.

Do not teach the 24-hour late-cancel flag as an existing 24-hour cancellation block. Do not use a runtime test to claim the proposed rule passes until the implementation is changed and the exact build is pinned.

## Evidence limitations
- Source inspection does not establish the deployed build or tenant-specific configuration.
- The OpenAPI document is not pinned in this course branch. Capture it from the exact disposable build used for the exercise.
- Route-level authorization, response status codes and response schemas must be verified against the pinned OpenAPI document and implementation.
- No mutating cancellation request has been run as part of this review.
