# 09 - Site Integration Lessons

This document records implementation notes that should be reused when adding other target sites.

## Registration Flow Guardrails

- Test the selected proxy before opening the browser or starting the registration flow.
- If proxy validation fails or times out, skip the job immediately.
- Do not save skipped or failed jobs into `Accounts`; write them to registration logs instead.
- Keep `Accounts` for successful credentials only.

## Temporary Email Providers

- Validate a generated inbox before filling the target site's registration form.
- Some Emailnator addresses open to a mailbox page that shows `Email is currently not available. Please try different email.`
- When that message is detected, discard the generated address and create another one.
- Retry inbox generation a bounded number of times; current TokenLB flow uses 5 attempts.
- The email provider contract supports an optional `validateInbox(ctx, inbox)` hook for this purpose.

## Browser Context vs Hidden HTTP

- In headless mode, provider HTTP clients can use direct `fetch` for speed and reliability.
- In non-headless mode, prefer executing provider requests from the provider page's browser context.
- For Emailnator, open the real mailbox route after generating an email:

```text
https://www.emailnator.com/mailbox/#<email>
```

- Use the page's cookies, XSRF token, and proxy/session context when calling provider endpoints from the page.
- Keep the target site registration browser separate from the temporary-email browser so navigation does not interrupt the registration form.

## New API Sites

- New API sites can require `New-Api-User` in addition to the login `session` cookie.
- Resolve the user id after login using cookies, local/session storage, visible keys pages, or user API endpoints.
- Token list endpoints may return masked keys only.
- For TokenLB/New API, use the copy endpoint to retrieve the full key:

```text
POST /api/token/{id}/key
```

## UI Expectations

- Keep tab state mounted when switching tabs so form state and logs are not reset.
- Provide bulk API-key creation with a skip-existing option.
- Export API keys as plain text using this format:

```text
account|key
```

## Failure Logging

- Failed registration attempts go to `registration-logs.json`.
- Successful accounts go to `accounts.json`.
- Expose a `Logs` tab for reviewing failures without polluting account management.
