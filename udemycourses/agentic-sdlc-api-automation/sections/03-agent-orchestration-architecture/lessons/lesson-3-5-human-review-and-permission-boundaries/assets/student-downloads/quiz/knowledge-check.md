# Knowledge check — Lesson 3.5: Human review and permission boundaries

Choose the single best answer.

1. **Agent Mode proposes a collection update based on an ambiguous requirement. What should happen?**
   - A. Accept automatically
   - B. Review the diff, resolve ambiguity and approve only the bounded change
   - C. Run it against production
   - D. Let the agent approve itself

2. **Which permission model is appropriate for a learner demo?**
   - A. Broad production credentials
   - B. Shared admin token in collection variables
   - C. Read-only access by default with isolated write access only when required and verified
   - D. No environment separation

3. **A CI run is green but required business evidence is missing. Who can waive the release gate?**
   - A. The test-planning agent
   - B. The failure-diagnosis agent
   - C. A deterministic rule should silently waive it
   - D. An authorised human under documented policy

## Answer key and explanations
1. **B.** The agent can propose; a human reviews high-impact or ambiguous changes.

2. **C.** Least privilege and isolated environments reduce impact.

3. **D.** Agents cannot waive mandatory release controls.
