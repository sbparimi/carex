# Knowledge check — Lesson 6.2: Run Postman CLI locally and interpret reports

Choose the single best answer.

1. **Which command runs a local collection file with Postman CLI?**
   - A. postman collection run <collection-file>
   - B. newman start
   - C. python run.py
   - D. postman api test

2. **The CLI reports a request error and a failed test assertion. How should these be interpreted?**
   - A. They are identical failures
   - B. Separate transport/request execution problems from assertion failures
   - C. Ignore the request error
   - D. Mark the collection green if some tests pass

3. **When does a local CLI run require a Postman API key?**
   - A. Always
   - B. Never under any circumstances
   - C. Not for a local file-only run; cloud result upload/authenticated resources may require authentication
   - D. Only when running GET

## Answer key and explanations
1. **A.** The documented collection command runs a local collection path.

2. **B.** Different failure types need separate diagnosis.

3. **C.** Authentication depends on local/cloud workflow and resource linking.
