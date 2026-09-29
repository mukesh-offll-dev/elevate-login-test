# elevate-login-test

Standalone Playwright + TypeScript suite for the **Thinkster Elevate parent login** and the **hellothinkster free-trial signup** funnel.

Self-contained: it does not touch or depend on the `jenkins-sandbox-free-trial-testing` project in the same folder.

> Every selector, URL, redirect, error message and API endpoint documented here was observed against the **live production site on 2026-09-28**. Nothing was invented. Anything that could not be reached is marked **pending**, not passing.

---

## Contents

- [Quick start](#quick-start)
- [Commands](#commands)
- [Safety model](#safety-model-read-before-enabling-any-gate)
- [Test email policy](#test-email-policy)
- [What the live site actually does](#what-the-live-site-actually-does)
- [Test coverage](#test-coverage)
- [Known blockers and findings](#known-blockers-and-findings)
- [Latest run](#latest-run)
- [Disclosure](#disclosure-side-effects-created-during-investigation)
- [Project layout](#project-layout)

---

## Quick start

```bash
cd elevate-login-test
npm install
cp .env.example .env     # Windows: copy .env.example .env
npm run typecheck
npm test
```

No Playwright browser download is needed — the suite runs on your installed system Chrome via `BROWSER_CHANNEL=chrome`. `VIDEO=off` keeps FFmpeg out of the picture.

`npm test` is safe by default: **no account is created, no payment is submitted, and no email is sent.**

## Commands

| Command | What it does |
|---|---|
| `npm test` | Full suite, safe defaults (headless Chrome) |
| `npm run test:login` | `tests/login.spec.ts` only |
| `npm run test:signup` | `tests/signup.spec.ts` only |
| `npm run test:headed` | Visible browser, useful for debugging |
| `npm run test:report` | Open the HTML report |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run inspect` | Read-only DOM dump of all three pages — catches selector drift without touching the backend |
| `npm run clean` | Delete `playwright-report/`, `test-results/`, `artifacts/` |

---

## Safety model (read before enabling any gate)

**The most important finding in this project:** on the real site, the signup funnel writes to the backend at **step 1**, not step 2.

Clicking the step 1 "Continue" / "Start" button fires:

```
POST https://core-api-4.0.hellothinkster.com/api/register/lead
POST https://core-api-4.0.hellothinkster.com/api/registration/step-progress/v2
```

So **any email typed into signup step 1 becomes a real lead in Thinkster's CRM** the moment that button is clicked. The suite is built around that fact.

| Gate | Default | Unlocks |
|---|---|---|
| `RUN_LIVE_SIGNUP` | `false` | Leaving signup step 1 (creates a lead). Required for SIGNUP-06 → 09. |
| `RUN_PAYMENT` | `false` | Card entry / subscription activation. Also requires `RUN_LIVE_SIGNUP=true` **and** `TEST_CARD_*`. |
| `ALLOW_UNIQUE_EMAIL` | `false` | Generating a fresh address for a real registration attempt. |
| `SEND_PASSWORD_RESET` | `false` | Actually submitting Forgot Password (sends a real recovery email). |

Additional hard stops built into the code:

- **The final account-creation button is never clicked.** In the `free-trial` variant that is `#twCtaVAAbout`; SIGNUP-07 deliberately stops with it *enabled but unclicked* and annotates `stopped-by-design`.
- `SIGNUP-00` fails the build if `RUN_PAYMENT=true` is set without `RUN_LIVE_SIGNUP=true` and a configured test card.
- **reCAPTCHA is never bypassed.** If an interactive challenge appears, the run records sanitized evidence and annotates `security-rejection`. No registration success is ever fabricated.
- Card numbers, CVVs, OTPs, passwords and reCAPTCHA tokens are redacted before anything is written to an artifact. Request and response **bodies are never captured** — diagnostics store method, status and a query-stripped URL only.

## Test email policy

**Only `@tabtortest.com` addresses are ever typed into a Thinkster form.** This is enforced in code, not by convention.

`assertApprovedEmail()` in `src/utils/test-data.ts` throws on anything else, and it is called at both choke points in `SignupPage.ts` — `enterEmail()` and again inside `submitStep1()`:

```ts
async submitStep1(): Promise<SignupVariant> {
  assertApprovedEmail(await this.emailInput.inputValue());  // refuses off-domain
  ...
}
```

| Constant | Value | Used by |
|---|---|---|
| `nonExistentEmail` | `qa.no.such.parent@tabtortest.com` | LOGIN-04 wrong credentials |
| `formProbeEmail` | `qa.form.probe@tabtortest.com` | SIGNUP-03 required-field check |
| `uniqueEmail()` | `qa.elevate+<timestamp>@tabtortest.com` | gated new-account runs only |
| `ELEVATE_PARENT_EMAIL` | from `.env` | LOGIN-07/08, SIGNUP-06 (operator-authorized) |

Two intentional exceptions, neither of which is a deliverable address:

- `malformedEmail = 'not-an-email'` — has no domain at all; that *is* the test input for format validation. It is never submitted to signup.
- `'you@example.com'` in `login.spec.ts` — Thinkster's own placeholder text on their input, asserted against. Never typed.

Override the domain with `TEST_EMAIL_DOMAIN` in `.env` if your team uses a different sink.

---

## What the live site actually does

### Elevate login — `https://elevate.hellothinkster.com/login`

React component `login-form.tsx` (from `data-sentry-source-file`).

| Control | Selector | Notes |
|---|---|---|
| Email | `#email` | `type="email"`, placeholder `you@example.com`, **no `required` attribute** |
| Password | `#password` | `type="password"`, placeholder `••••••••` |
| Show/hide password | `#password ~ button` | `type="button"`, **no accessible name** — cannot be located by role+name |
| Remember me | `#remember` | Radix `role="checkbox"` button, state via `data-state`, not a real `<input>` |
| Forgot password | `a[href="/forgot-password"]` | |
| Submit | `button[type=submit]` "Sign In" | |
| Free trial | `a[href="https://hellothinkster.com/start/sign-up.html"]` | `target="_blank"`, **no `rel`** |
| Social | "Continue with Google" / "Continue with Facebook" | Not exercised |

Verified behaviour:

- **Empty submit** → inline `Email is required` and `Password is required`. No navigation.
- **Malformed email** (`not-an-email`) → blocked by **native HTML5 constraint validation** (`validity.typeMismatch === true`); the form does *not* set `novalidate`. No app-level error text appears and **no request is sent** — LOGIN-03 asserts the absence of `POST /api/auth/login`.
- **Wrong credentials** → `POST /api/auth/login` returns **401**, UI shows `Invalid email or password. Please try again.` Message is generic — it does not leak whether the account exists.
- **Password toggle** → `password` → `text` → `password`.
- **Forgot password** → `/forgot-password`: heading "Reset Password", `#email` (placeholder `Enter your email`), "Reset Password" button, "Back to Login" → `/login`.

Protected-route probe from a clean context:

| Path | Result |
|---|---|
| `/` | 200, then client-side redirect → `/login` |
| `/students` | 200, then client-side redirect → `/login` |
| `/dashboard` | 200, then client-side redirect → `/login` |
| `/parent` | **404** |
| `/settings` | **404** |

### Signup — the link redirects, and the page is A/B tested

The login page link resolves through two 308s:

```
https://hellothinkster.com/start/sign-up.html
  → 308 https://www.hellothinkster.com/start/sign-up.html
  → 308 https://www.hellothinkster.com/start/sign-up   (200, "Registration | Thinkster Online Math Coaching")
```

> The `FREE_TRIAL_URL` in the original brief — `https://www.hellothinkster.com/start/sign-u` — is truncated and invalid. `.env.example` ships the verified canonical URL.

**The page serves two completely different funnels at random (~50/50, Statsig-driven).** Element IDs differ between them and no forcing cookie or query parameter was found, so `SignupPage` detects the variant per page load and never assumes one.

#### Variant A — `free-trial` · heading "Get started with your free trial"

| Step | Controls |
|---|---|
| 1 | `#twVAEmail` (label "Parent email address") · `#twCtaVAStart` "Continue" (disabled while empty) · `#twVAGoogleBtn` · `#twVAFbBtn` |
| 2 "Tell us about yourself" | `#twVAFirst` · `#twVALast` · `#twVAPhone` · `#twCcBtn` (+ `#twCcSearch`) · `#twVASmsConsent` · `#twVAPw` · `#twVAPwCount` · `#twVABack` · **`#twCtaVAAbout` ← account-creation boundary, never clicked** |

Step 2 gating — `#twCtaVAAbout` enables only when *all* hold: first name, last name, **10-digit** phone, password **≥ 8** chars. Boundary confirmed: 7 chars disabled, exactly 8 enabled. Phone auto-masks `9080204336` → `(908) 020-4336`. **The SMS/AI-call consent checkbox does *not* gate the button.** `#twVABack` returns to step 1 and preserves the email.

#### Variant B — `accelerator` · heading "The Math Confidence Accelerator System"

A longer funnel that **does** include the student and grade steps:

| Step | Controls |
|---|---|
| 1 | `#twEmailFld` (placeholder "Parent email address") · `#twCtaLanding` "Start" |
| 2 "You just did the hard part." | `#twCtaCongrats` · `#twSkipVid` "Skip the video" |
| 3 "How many children…?" | 1 / 2 / 3 · `#twCtaCount` |
| 4 "Let's start your child at exactly the right level." | **`#twNameFld`** (student first name) · **grade sliders** `#hSchool` (`role=slider`, `aria-label="School grade"`, 0–11) and `#hWork` ("Working grade") · axes `#axis1` / `#axis2` with `div.sp-tlab` ticks `K 1…8 AL1 AL2` · values `#twV1` / `#twV2` ("Grade 5") · `#twCtaGrade` |
| 5 "What's the one thing you want to change for `<child>`?" | goal options · `#twCtaQ1` |

`#twCtaGrade`'s label acts as a progress hint: `Add their name` → `Answer question 1` → `Next question` → `Continue`. Step 5's heading is personalised with the student's name, which confirms step 4 data propagates.

#### Shared by both variants

- **No `<form>` wraps the email field** — the funnel is entirely JS-driven. (Page-wide `<form>` counts are flaky; third-party marketing widgets inject their own later, so SIGNUP-02 asserts `el.closest('form') === null` instead.)
- Invisible reCAPTCHA, site key `6Lc4XnYsAAAAAODq0svz1csIi7-fUCynO2pTOsP5`, loads on the first step transition and fills `textarea[name=g-recaptcha-response]`.
- A hidden pricing sheet ships with the page: `#twSheet.tw-sheet.pricing-plans` ("Your plan options") with `#twSegBill` / `#twChildPlans` / `#twSumPrice` — **but no card fields.**

---

## Test coverage

### `tests/login.spec.ts`

| ID | Case | Status |
|---|---|---|
| LOGIN-01 | Page loads; all essential controls visible | ✅ passing |
| LOGIN-02 | Empty email + password → inline required errors | ✅ passing |
| LOGIN-03 | Malformed email rejected **and no `/api/auth/login` sent** | ✅ passing |
| LOGIN-04 | Wrong credentials → 401 + generic error, no secrets leaked | ✅ passing |
| LOGIN-05 | Password visibility toggle | ✅ passing |
| LOGIN-06 | Forgot Password navigation, no email sent | ✅ passing (submission gated) || LOGIN-07 | Successful login with `.env` credentials | ⏭️ skipped — no credentials set |
| LOGIN-08 | Authenticated landing, refresh persistence, logout | ⏭️ skipped — no credentials set |
| LOGIN-09 | Protected routes redirect to `/login` when unauthenticated | ✅ passing |
| LOGIN-10 | Screenshot/trace-on-failure config is correct | ✅ passing |

### `tests/signup.spec.ts`

| ID | Case | Status |
|---|---|---|
| SIGNUP-00 | Safety guard — default run creates nothing | ✅ passing |
| SIGNUP-01 | Signup link → real registration page, via new tab + 308 chain | ✅ passing |
| SIGNUP-02 | Step 1 controls for whichever variant is served | ✅ passing |
| SIGNUP-03 | Required-field validation (CTA disabled until email entered) | ✅ passing |
| SIGNUP-04 | **Known defect:** step 1 accepts a malformed email | ✅ passing (documents the bug) |
| SIGNUP-05 | reCAPTCHA detected and reported, never bypassed | ✅ passing |
| SIGNUP-06 | Existing parent email cannot register twice | 🔒 gated — needs `RUN_LIVE_SIGNUP` + `ELEVATE_PARENT_EMAIL` |
| SIGNUP-07 | `free-trial` variant: required fields, phone mask, password rules | 🔒 gated |
| SIGNUP-08 | `free-trial` variant: Back preserves email; country picker | 🔒 gated |
| SIGNUP-09 | `accelerator` variant: student info + grade selection | 🔒 gated |
| SIGNUP-10 | OTP phone verification | ⚠️ **pending — never rendered** |
| SIGNUP-11 | Billing entry / subscription activation | ⚠️ **pending — never rendered** |
| SIGNUP-12 | Post-signup destination | ⚠️ **pending by design** |

`⚠️ pending` cases are `test.fixme`, so they appear explicitly in the report. They are **not** claimed as verified.

To run the gated signup cases against an authorized test account:

```bash
# creates a real lead — authorized test accounts only
RUN_LIVE_SIGNUP=true ALLOW_UNIQUE_EMAIL=true npm run test:signup
```

```powershell
# PowerShell
$env:RUN_LIVE_SIGNUP="true"; $env:ALLOW_UNIQUE_EMAIL="true"; npm run test:signup
```

---

## Known blockers and findings

**1. Signup step 1 has no email-format validation — `SIGNUP-04`**
Entering `not-an-email` enables the CTA, and clicking it advances the funnel *and* POSTs `/api/register/lead`. Junk, unreachable addresses enter the CRM. The Elevate login form gets this right via `type="email"`; the signup funnel does not. The test asserts the client-side state only and deliberately does not click.

**2. Step 1 is the side-effect boundary, not step 2**
Easy to get wrong when writing signup automation. Any suite that "just fills in the email and clicks Continue to inspect step 2" is creating leads. Hence `RUN_LIVE_SIGNUP` and the `assertApprovedEmail()` guards.

**3. A/B testing makes ID-based selectors unreliable**
Two funnels with different IDs are served at random. A suite pinned to `#twVAEmail` fails roughly half the time — this is exactly how the variant was discovered. `SignupPage` resolves both ID sets and branches on `variant()`.

**4. OTP and billing are unreachable without creating an account**
The phone label promises "we'll text a code to verify it", but no OTP input was ever rendered in either variant, and no OTP / Stripe / checkout / billing endpoint appears in the page scripts. The hidden pricing sheet contains no card fields. Card capture must happen after account creation. Marked pending.

**5. Post-login DOM is unverified**
`ELEVATE_PARENT_EMAIL` / `ELEVATE_PARENT_PASSWORD` were not supplied, so the authenticated layout was never observed. `AuthenticatedArea.logout()` probes the common patterns (button / menuitem / link matching `log out|sign out`, including inside an account menu) and, if none matches, LOGIN-08 annotates `pending` rather than silently passing.

**6. Desktop Browser MCP was unavailable**
The desktop browser tool reported `browser.disconnected` for this session. **All DOM inspection was performed with the Playwright MCP server against the live site instead** — same real-DOM evidence, different transport. Nothing was assumed.

**7. Minor: `target="_blank"` without `rel="noopener noreferrer"`**
The signup link on the login page. Modern browsers imply `noopener`, so impact is low, but SIGNUP-01 annotates it as a `security-note`.

**8. reCAPTCHA posture**
Invisible/v3-style. It populated a token during automated inspection and did **not** present an interactive challenge, so it did not block the flow. If that changes, SIGNUP-05 records sanitized evidence and annotates `security-rejection`. The suite will never solve or bypass a CAPTCHA.

### Stability traps found while hardening the suite

These are real characteristics of the live site. Each caused an intermittent failure until handled properly — worth knowing before extending the suite.

| Trap | Symptom | Handling |
|---|---|---|
| Signup link is `target="_blank"` | `waitForURL` on the current page times out — the original tab never navigates | `context.waitForEvent('page')` and assert on the popup |
| Next.js prefetches routes continuously | `click()` hangs on *"waiting for scheduled navigations to finish"* | `click({ noWaitAfter: true })`; the new tab is the real signal |
| GA cross-domain linker appends `?_gl=…` | Exact URL equality fails on ~1 load in 4 | Compare `origin` + `pathname`; record `_gl` presence as a diagnostic |
| Third-party widgets inject a late `<form>` | `page.locator('form').count() === 0` fails intermittently | Assert `emailInput.closest('form') === null` instead |
| Marketing site is script-heavy | `waitForLoadState` on the popup stalls past the test timeout under parallel load | Wait for navigation `commit` only; assert on content, and cap workers at 4 |


---

## Latest run

`npm install` → `npm run typecheck` → `npm test`, Chrome 153, 2026-09-28. Four consecutive full runs, identical result:

```
14 passed
 9 skipped   (2 missing credentials, 4 gated, 3 pending fixme)
 0 failed
```

`typecheck` clean under `strict` + `noUnusedLocals` + `noUnusedParameters`.

No account was created, no payment submitted, no recovery email sent.

Breakdown of the 9 skips:

| Skipped | Why |
|---|---|
| LOGIN-07, LOGIN-08 | `ELEVATE_PARENT_EMAIL` / `ELEVATE_PARENT_PASSWORD` not set |
| SIGNUP-06 … SIGNUP-09 | `RUN_LIVE_SIGNUP=false` — would create a lead |
| SIGNUP-10 … SIGNUP-12 | `test.fixme` — the site never rendered these steps |

## Disclosure: side effects created during investigation

Full transparency — mapping the funnel required clicking step 1, which I only learned creates a lead *by doing it*. The following addresses now exist as **leads** in Thinkster's funnel:

- `not-an-email` (malformed — this is what proved finding #1)
- `qa.automation.probe@example.com`
- `qa.variant.probe@example.com` … `qa.variant.probe6@example.com`

**No accounts were created and no payment was ever submitted** — the account-creation CTA was never clicked, and no card or OTP screen was reached.

Those `@example.com` addresses were a poor choice and prompted the `@tabtortest.com` policy. The `assertApprovedEmail()` guards now make a repeat impossible: an off-domain address throws before it can reach `/api/register/lead`. You may want to ask Thinkster to purge those leads.

---

## Artifacts

| Path | Contents | Committed? |
|---|---|---|
| `playwright-report/` | HTML report | No |
| `artifacts/junit-results.xml` | JUnit XML for CI | No |
| `artifacts/*.json` | Sanitized diagnostics (redacted) | No |
| `test-results/` | Failure screenshots + traces | No |

Tracing is configured **once** in `playwright.config.ts` as `retain-on-failure`. Specs never call `context.tracing.start()` — doing so would throw *"Tracing has been already started"*. Screenshots are `only-on-failure`; video is `off` when `VIDEO=off`.

View a trace:

```bash
npx playwright show-trace test-results/<test-dir>/trace.zip
```

## Project layout

```
elevate-login-test/
├── tests/
│   ├── login.spec.ts          LOGIN-01 … LOGIN-10
│   └── signup.spec.ts         SIGNUP-00 … SIGNUP-12
├── src/
│   ├── pages/
│   │   ├── LoginPage.ts       LoginPage, ForgotPasswordPage, AuthenticatedArea
│   │   └── SignupPage.ts      variant-aware POM + full DOM map in the header comment
│   └── utils/
│       ├── test-data.ts       env config, gates, email policy, assertApprovedEmail()
│       └── diagnostics.ts     redaction, sanitized network capture, reCAPTCHA detection
├── scripts/inspect-dom.ts     read-only DOM dump (npm run inspect)
├── artifacts/                 reports, screenshots, sanitized diagnostics
├── .env.example               every secret blank by default
├── .gitignore                 ignores .env, node_modules, reports, artifacts
├── playwright.config.ts       single tracing config, system Chrome, video off
├── tsconfig.json              strict
└── README.md
```

**Design notes:** Page Object Model throughout; each test is independent and does its own navigation; waits are all assertion- or event-based (`expect().toBeVisible()`, `waitForResponse`, `waitForURL`, `context.waitForEvent('page')`) with **no fixed sleeps**; accessible role/label selectors are preferred, falling back to IDs only where the live DOM offers no accessible name (the password toggle, and the signup funnel's unlabelled fields).





