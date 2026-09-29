import 'dotenv/config';

/**
 * Central, typed access to environment configuration.
 *
 * Nothing in this file may contain a real credential, card number, CVV or OTP.
 * Every sensitive value is read from the environment at run time and is
 * redacted before it can reach a log, screenshot or report.
 */

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

/**
 * Observed 2026-09-28 via Browser MCP:
 *   https://hellothinkster.com/start/sign-up.html
 *     -> 308 https://www.hellothinkster.com/start/sign-up.html
 *     -> 308 https://www.hellothinkster.com/start/sign-up        (200, final)
 *
 * The FREE_TRIAL_URL supplied in the original brief
 * ("https://www.hellothinkster.com/start/sign-u") is truncated and 404s, so the
 * verified canonical destination below is used as the default.
 */
export const urls = {
  login: str('ELEVATE_LOGIN_URL', 'https://elevate.hellothinkster.com/login'),
  freeTrial: str('FREE_TRIAL_URL', 'https://www.hellothinkster.com/start/sign-up'),
  /** Raw href of the "Sign up for a free trial" link rendered on the login page. */
  loginSignupHref: 'https://hellothinkster.com/start/sign-up.html',
  forgotPasswordPath: '/forgot-password',
  /** Elevate origin, derived from the login URL so one env var drives both. */
  get elevateOrigin(): string {
    return new URL(this.login).origin;
  },
} as const;

/** Endpoints confirmed with Browser MCP. Used for assertions and diagnostics only. */
export const endpoints = {
  /** POST, returns 401 for wrong credentials. */
  login: '/api/auth/login',
  /** Fired by signup step 1 "Continue" -> creates a server-side lead. */
  registerLead: 'core-api-4.0.hellothinkster.com/api/register/lead',
  stepProgress: 'core-api-4.0.hellothinkster.com/api/registration/step-progress',
} as const;

/** Literal copy observed in the live UI. Asserted on, so keep in sync with the app. */
export const copy = {
  loginHeading: 'Welcome to Thinkster',
  emailRequired: 'Email is required',
  passwordRequired: 'Password is required',
  invalidCredentials: 'Invalid email or password. Please try again.',
  forgotHeading: 'Reset Password',
  forgotSubmit: 'Reset Password',
  backToLogin: 'Back to Login',
  signupStep1Heading: 'Get started with your free trial',
  signupStep2Heading: 'Tell us about yourself',
  recaptchaNotice: 'This site is protected by reCAPTCHA',
} as const;

export const parentAccount = {
  email: str('ELEVATE_PARENT_EMAIL'),
  password: str('ELEVATE_PARENT_PASSWORD'),
  firstName: str('PARENT_FIRST_NAME', 'Mukesh'),
  lastName: str('PARENT_LAST_NAME', 'Automation'),
  country: str('PARENT_COUNTRY', 'United States'),
  countryCode: str('PARENT_COUNTRY_CODE', '+1'),
  phone: str('PARENT_PHONE'),
} as const;

export const student = {
  firstName: str('STUDENT_FIRST_NAME', 'Mukesh'),
  grade: str('STUDENT_GRADE', '5'),
} as const;

export const billing = {
  postalCode: str('BILLING_POSTAL_CODE', '07001'),
  country: str('BILLING_COUNTRY', 'United States'),
  cardNumber: str('TEST_CARD_NUMBER'),
  cardExpiry: str('TEST_CARD_EXPIRY'),
  cardCvc: str('TEST_CARD_CVC'),
} as const;

export const otp = str('SANDBOX_OTP');

/** Destructive-action gates. Both default to false so `npm test` is always safe. */
export const gates = {
  /** Allows anything that writes to the Thinkster backend (lead creation, account creation). */
  runLiveSignup: bool('RUN_LIVE_SIGNUP', false),
  /** Allows card entry / subscription activation. Requires runLiveSignup as well. */
  runPayment: bool('RUN_PAYMENT', false),
  /** Allows generating a brand-new unique email for a real registration attempt. */
  allowUniqueEmail: bool('ALLOW_UNIQUE_EMAIL', false),
  /** Allows actually submitting the Forgot Password form (sends a recovery email). */
  sendPasswordReset: bool('SEND_PASSWORD_RESET', false),
} as const;

export const hasParentCredentials = Boolean(parentAccount.email && parentAccount.password);
export const hasTestCard = Boolean(billing.cardNumber && billing.cardExpiry && billing.cardCvc);

/**
 * TEST EMAIL DOMAIN POLICY
 * ------------------------
 * Every address this suite types into a Thinkster form must be on the approved
 * test domain below. Never use example.com, a personal address, or a real
 * customer address: the signup funnel POSTs step 1 to /api/register/lead, so any
 * address entered there becomes a real lead in Thinkster's CRM.
 */
export const TEST_EMAIL_DOMAIN = str('TEST_EMAIL_DOMAIN', 'tabtortest.com');

/** Deterministic-per-run unique address, only used when explicitly enabled. */
export function uniqueEmail(prefix = 'qa.elevate'): string {
  const suffix = str('EMAIL_UNIQUE_SUFFIX') || `${Date.now()}`;
  return `${prefix}+${suffix}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Generates a fresh, collision-resistant signup email for every test iteration.
 *
 * Format:  test<DD><MM><HH><mm>+<ss><mmm>@<TEST_EMAIL_DOMAIN>
 * Example: test29091030+12456@tabtortest.com
 *          (29th day, September, 10:30, second 12, millisecond 456)
 *
 * The seconds+milliseconds suffix prevents collisions when multiple tests run
 * within the same minute. No real parent credentials are involved.
 * The address passes the assertApprovedEmail guard because it uses TEST_EMAIL_DOMAIN.
 */
export function signupEmail(): string {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const p3 = (n: number) => String(n).padStart(3, '0');
  const base = `test${p2(now.getDate())}${p2(now.getMonth() + 1)}${p2(now.getHours())}${p2(now.getMinutes())}`;
  const sub  = `${p2(now.getSeconds())}${p3(now.getMilliseconds())}`;
  return `${base}+${sub}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Syntactically valid address on the approved test domain that must never
 * resolve to a real account. Used for the wrong-credentials login test, which
 * only ever hits POST /api/auth/login and never the signup funnel.
 */
export const nonExistentEmail = `qa.no.such.parent@${TEST_EMAIL_DOMAIN}`;

/** Placeholder address for pure client-side checks that never leave the browser. */
export const formProbeEmail = `qa.form.probe@${TEST_EMAIL_DOMAIN}`;

export const throwawayPassword = 'NotARealPassword!2468';
export const malformedEmail = 'not-an-email';

/** Every secret-bearing value, for the diagnostics redactor. */
export function secretValues(): string[] {
  return [
    parentAccount.password,
    parentAccount.email,
    billing.cardNumber,
    billing.cardExpiry,
    billing.cardCvc,
    otp,
    throwawayPassword,
    process.env.ELEVATE_PARENT_PASSWORD ?? '',
  ].filter((v): v is string => Boolean(v && v.length >= 3));
}

/**
 * Hard guard against typing an unapproved address into a Thinkster form.
 *
 * Signup step 1 POSTs to /api/register/lead, so a stray example.com or personal
 * address would create a real lead. Call this before any email is submitted to
 * the signup funnel. ELEVATE_PARENT_EMAIL is allowed through because it is an
 * explicitly authorized account supplied by the operator.
 */
export function assertApprovedEmail(email: string): string {
  if (parentAccount.email && email === parentAccount.email) return email;
  if (!email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN.toLowerCase()}`)) {
    throw new Error(
      `Refusing to submit "${email}": signup emails must be on the approved test domain @${TEST_EMAIL_DOMAIN} (or ELEVATE_PARENT_EMAIL).`,
    );
  }
  return email;
}
