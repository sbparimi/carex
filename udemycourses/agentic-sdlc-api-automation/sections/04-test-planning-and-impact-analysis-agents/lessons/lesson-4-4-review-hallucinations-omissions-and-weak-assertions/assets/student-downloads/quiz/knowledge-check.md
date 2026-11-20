# Knowledge check — 4.4 Review Hallucinations Omissions And Weak Assertions

Answer before reading the explanations. Each question has one best answer.

1. What is the strongest evidence that **review hallucinations omissions and weak assertions** has been applied successfully?
   - A. The team documented its intention.
   - B. A reproducible artefact meets explicit acceptance criteria.
   - C. An AI summary says it looks correct.
   - D. A single run completed without retained evidence.

2. A required input is missing or ambiguous. What should the workflow do?
   - A. Guess silently.
   - B. Treat the missing value as confirmed.
   - C. Record uncertainty, assess impact and seek clarification or use an approved safe default.
   - D. Hide uncertainty in the report.

3. Which verification is strongest?
   - A. Trust the agent's self-assessment.
   - B. Independently check the result against acceptance criteria and retain evidence.
   - C. Check only for HTTP 200.
   - D. Assume one successful demo guarantees future runs.

## Answers and explanations
1. **B.** Reproducible evidence proves application; intention and unverified summaries do not.
2. **C.** Uncertainty must be visible and resolved or bounded by an approved policy.
3. **B.** Independent verification is stronger than self-assessment or superficial success.

Record your score and one change you would make to the CareX workflow.
