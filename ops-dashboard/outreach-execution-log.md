# Outreach Execution Log

Lead wedge: `restricted-party-screen`
Bundle / upsell: `vendor-entity-brief`

Sender identity used:
- `ke@liquidmercury.com`

## 2026-03-18 Day 1 First Wave

### 1. VISO TRUST

Target:
- Paul Valente, Chief Customer Officer & Co-Founder

Public channel attempted:
- public email to `info@visotrust.com`

Message angle:
- compliance and due diligence workflow compression

Result:
- success
- email sent from `ke@liquidmercury.com`

Blockers:
- none

### 2. AuthBridge

Target:
- Ajay Trehan, Founder & Chief Executive Officer

Public channel attempted:
- vendor onboarding contact form at `https://authbridge.com/solutions/vendor-onboarding/`

Message angle:
- procurement and vendor onboarding

Result:
- blocked on first route
- form did not produce a submission event; network trace showed no contact POST

Fallback channel attempted:
- public sales email to `sales@authbridge.com`

Fallback result:
- success
- email sent from `ke@liquidmercury.com`

Blockers:
- the vendor-onboarding form route was brittle and did not submit cleanly

### 3. OneCredential

Target:
- public contact form / support contact

Public channel attempted:
- contact form at `https://www.onecredential.io/contact-us`

Message angle:
- procurement and vendor onboarding

Result:
- success
- form returned confirmation: "Thank you! Your submission has been received!"

Blockers:
- none

## Summary

- Attempted 3 public outreach paths for the first wave.
- Successes: 3 successful public sends/submissions total.
- Blockers: 1 brittle form route on AuthBridge, which was bypassed by a public sales mailbox.
- Best follow-up: monitor the `ke@liquidmercury.com` inbox for replies and move any responder into a live workflow test.

## 2026-03-18 Day 1 Second Wave

### 4. Fraxtional

Target:
- Ryan Cimo, Founder & Chief Executive Officer

Public channel attempted:
- contact form at `https://www.fraxtional.co/contact-us`

Message angle:
- compliance and due diligence advisors

Result:
- success
- form submitted successfully from `ke@liquidmercury.com`

Blockers:
- none

### 5. CFO Pro Analytics

Target:
- Salvatore Tirabassi, Managing Director

Public channel attempted:
- public email to `info@cfoproanalytics.com`

Message angle:
- finance ops and AP

Result:
- success
- email sent from `ke@liquidmercury.com`

Blockers:
- none

### 6. Valua Partners

Target:
- Chris Lazarte, Partner

Public channel attempted:
- public email to `info@valuapartners.com`
- public contact form at `https://valuapartners.com/contact/`

Message angle:
- finance ops and AP

Result:
- blocked
- email send via Outlook COM was not confirmable because the RPC server rejected the call
- form submission failed with reCAPTCHA validation failure

Blockers:
- Outlook RPC instability on the email route
- reCAPTCHA failure on the public form route

## Second Wave Summary

- Confirmed additional sends/submissions: 2
- Blocked routes: 1 target with both the email and form path blocked
- Best follow-up: keep the confirmed replies warm and re-try Valua only if a cleaner mail route or human-assisted form path is available
