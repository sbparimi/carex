# Instructor script — Lesson 4.2 (25 minutes)

## Outcome
Learners can use Postman Agent Mode to generate a scenario matrix that includes positive, negative, boundary, ownership, role, state and timezone coverage.

## 1. Opening — 2 min
Show the seed CSV. Ask: “If the rule says more than 24 hours, what happens at exactly 24 hours?” Learners write a prediction before seeing the generated matrix.

## 2. Concept — 4 min
Explain equivalence partitions and boundary-value analysis. Distinguish 25h, exactly 24h, 23h59m59s and 24h+1s. Explain why ownership and staff-role regression are separate from the time boundary. Surface DST ambiguity: elapsed duration and local wall-clock arithmetic are not always equivalent.

## 3. Why — 3 min
A missing exact-boundary test can leave the core business rule unverified. A staff regression test protects against accidentally applying the patient-only rule to staff workflows.

## 4. Demo — 6 min
Run the Agent Mode prompt with the fixture and seed CSV. Inspect the proposed scenarios. Intentionally show a weak proposal that groups exactly 24h and less than 24h into one row. Ask learners what is lost by that grouping.

## 5. Build — 5 min
Learners ask Agent Mode to produce the complete matrix. They review every row against the seed fixture and add evidence references. The agent may propose, but learners decide which cases are ready.

## 6. Verify — 4 min
Compare against the reference matrix. Check exact boundary, just-over, just-under, ownership, staff regression, already-cancelled state and DST. Mark contract-specific outcomes unverified where evidence is missing.

## 7. Recap — 1 min
The approved scenario matrix becomes the input to risk ranking in Lesson 4.3 and collection design in Section 5.

## Safety
Proposal-only Agent Mode. No mutating API calls. Use only synthetic appointments.
