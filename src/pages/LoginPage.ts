import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { copy, endpoints, urls } from '../utils/test-data';

/**
 * Page object for https://elevate.hellothinkster.com/login
 *
 * Every locator below was confirmed against the live DOM with Browser MCP on
 * 2026-09-28. Source component (from data-sentry-source-file): login-form.tsx.
 *
 * Verified markup:
 *   <input id="email"    type="email"    placeholder="you@example.com">  (no `required` attr)
 *   <input id="password" type="password" placeholder="••••••••">
 *   <button type="button">            <- password eye toggle, no accessible name
 *   <button role="checkbox" id="remember">  <- Radix checkbox, not a real <input>
 *   <a href="/forgot-password">Forgot password?</a>
 *   <button type="submit">Sign In</button>
 *   <a href="https://hellothinkster.com/start/sign-up.html">Sign up for a free trial</a>
 */
export class LoginPage {
  readonly page: Page;

  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly passwordToggle: Locator;
  readonly rememberMe: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signInButton: Locator;
  readonly signupLink: Locator;
  readonly googleButton: Locator;
  readonly facebookButton: Locator;

  readonly emailRequiredError: Locator;
  readonly passwordRequiredError: Locator;
  readonly invalidCredentialsError: Locator;

  constructor(page: Page) {
    this.page = page;

    this.heading = page.getByRole('heading', { level: 1, name: copy.loginHeading });
    // Accessible-name based; the <label for="email"> makes this resolve to #email.
    this.emailInput = page.getByLabel('Email', { exact: true });
    this.passwordInput = page.getByLabel('Password', { exact: true });
    // The toggle has no accessible name, so it is scoped as the sibling button
    // of the password input rather than matched by text.
    this.passwordToggle = page.locator('#password ~ button');
    this.rememberMe = page.getByRole('checkbox', { name: 'Remember me' });
    this.forgotPasswordLink = page.getByRole('link', { name: 'Forgot password?' });
    this.signInButton = page.getByRole('button', { name: 'Sign In', exact: true });
    this.signupLink = page.getByRole('link', { name: 'Sign up for a free trial' });
    this.googleButton = page.getByRole('button', { name: 'Continue with Google' });
    this.facebookButton = page.getByRole('button', { name: 'Continue with Facebook' });

    this.emailRequiredError = page.getByText(copy.emailRequired, { exact: true });
    this.passwordRequiredError = page.getByText(copy.passwordRequired, { exact: true });
    this.invalidCredentialsError = page.getByText(copy.invalidCredentials, { exact: true });
  }

  async goto(): Promise<void> {
    await this.page.goto(urls.login, { waitUntil: 'domcontentloaded' });
    await expect(this.signInButton).toBeVisible();
  }

  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submit(): Promise<void> {
    await this.signInButton.click();
  }

  /**
   * Submits and resolves with the /api/auth/login response.
   * Never logs the request body, which carries the password.
   */
  async submitAndCaptureAuthResponse(timeout = 30_000): Promise<Response> {
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes(endpoints.login) && r.request().method() === 'POST',
      { timeout },
    );
    await this.submit();
    return responsePromise;
  }

  /** Signs in without asserting the outcome. */
  async login(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.submit();
  }

  async passwordFieldType(): Promise<string | null> {
    return this.passwordInput.getAttribute('type');
  }

  /**
   * Native HTML5 constraint state of the email field.
   * The login form does NOT set novalidate, so a malformed address is rejected
   * by the browser before any request is sent (verified: typeMismatch === true).
   */
  async emailValidity(): Promise<{ valid: boolean; message: string; typeMismatch: boolean }> {
    return this.emailInput.evaluate((el) => {
      const input = el as HTMLInputElement;
      return {
        valid: input.checkValidity(),
        message: input.validationMessage,
        typeMismatch: input.validity.typeMismatch,
      };
    });
  }

  async isRememberMeChecked(): Promise<boolean> {
    return (await this.rememberMe.getAttribute('data-state')) === 'checked';
  }

  /**
   * Clicks "Sign up for a free trial" and returns the page it opens.
   *
   * Verified: the link is <a href="https://hellothinkster.com/start/sign-up.html"
   * target="_blank"> with NO rel attribute, so it opens a new tab rather than
   * navigating the current one.
   *
   * `noWaitAfter` is required here: this Next.js page continuously schedules
   * background route prefetches, so a default click blocks on "waiting for
   * scheduled navigations to finish" and times out intermittently. The new tab
   * is awaited via the context 'page' event instead, which is the real signal.
   */
  async openSignupInNewTab(): Promise<Page> {
    const context = this.page.context();
    await expect(this.signupLink).toBeVisible();
    await this.signupLink.scrollIntoViewIfNeeded();
    const popupPromise = context.waitForEvent('page', { timeout: 45_000 });
    await this.signupLink.click({ noWaitAfter: true });
    const signupPage = await popupPromise;
    // Wait only for the navigation to commit. Waiting for 'load' or even
    // 'domcontentloaded' here is unreliable: the marketing site pulls in a large
    // number of third-party scripts and can stall well past the test timeout
    // under parallel load. Callers assert on real content instead, which
    // auto-waits and is the meaningful signal.
    await signupPage.waitForURL(/hellothinkster\.com\/start\/sign-up/, {
      waitUntil: 'commit',
      timeout: 45_000,
    });
    return signupPage;
  }
}

/**
 * Page object for https://elevate.hellothinkster.com/forgot-password
 * Verified DOM: heading "Reset Password", <input id="email" placeholder="Enter your email">,
 * button "Reset Password", link "Back to Login" -> /login.
 */
export class ForgotPasswordPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly backToLoginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: copy.forgotHeading });
    this.emailInput = page.getByLabel('Email', { exact: true });
    this.submitButton = page.getByRole('button', { name: copy.forgotSubmit });
    this.backToLoginLink = page.getByRole('link', { name: copy.backToLogin });
  }

  async goto(): Promise<void> {
    await this.page.goto(`${urls.elevateOrigin}${urls.forgotPasswordPath}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(this.heading).toBeVisible();
  }
}

/**
 * Minimal representation of the authenticated area.
 *
 * Verified unauthenticated behaviour (fresh context, Browser MCP 2026-09-28):
 *   GET /           -> 200 then client-side redirect to /login
 *   GET /students   -> 200 then client-side redirect to /login
 *   GET /dashboard  -> 200 then client-side redirect to /login
 *   GET /parent     -> 404
 *   GET /settings   -> 404
 * Post-login layout could not be observed because no parent credentials were
 * supplied, so logout controls are discovered defensively at run time.
 */
export class AuthenticatedArea {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Candidate protected paths that redirect to /login when unauthenticated. */
  static readonly protectedPaths = ['/', '/students', '/dashboard'] as const;

  async isOnLoginPage(): Promise<boolean> {
    return new URL(this.page.url()).pathname.startsWith('/login');
  }

  async waitForRedirectToLogin(timeout = 20_000): Promise<void> {
    await this.page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout });
  }

  /** Tries the control patterns most likely to log a parent out. Returns true if one was found. */
  async logout(): Promise<boolean> {
    const candidates: Locator[] = [
      this.page.getByRole('button', { name: /log ?out|sign ?out/i }),
      this.page.getByRole('menuitem', { name: /log ?out|sign ?out/i }),
      this.page.getByRole('link', { name: /log ?out|sign ?out/i }),
    ];

    for (const candidate of candidates) {
      if (await candidate.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        await candidate.first().click();
        return true;
      }
    }

    // Logout is commonly nested inside an account/profile menu.
    const menus: Locator[] = [
      this.page.getByRole('button', { name: /account|profile|menu|avatar/i }),
      this.page.locator('[data-testid*="user" i], [data-testid*="account" i]'),
    ];
    for (const menu of menus) {
      if (await menu.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        await menu.first().click();
        for (const candidate of candidates) {
          if (await candidate.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
            await candidate.first().click();
            return true;
          }
        }
      }
    }
    return false;
  }
}
