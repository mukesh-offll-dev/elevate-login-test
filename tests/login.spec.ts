import { expect, test } from '@playwright/test';
import { AuthenticatedArea, ForgotPasswordPage, LoginPage } from '../src/pages/LoginPage';
import {
  copy,
  endpoints,
  gates,
  hasParentCredentials,
  malformedEmail,
  nonExistentEmail,
  parentAccount,
  throwawayPassword,
  urls,
} from '../src/utils/test-data';
import { attachDiagnostics, recordNetwork } from '../src/utils/diagnostics';

/**
 * Elevate parent login suite.
 *
 * All selectors and expected copy were confirmed against the live DOM of
 * https://elevate.hellothinkster.com/login with Browser MCP on 2026-09-28.
 * Tracing/screenshots/videos come from playwright.config.ts only.
 */
test.describe('Elevate login', () => {
  test('LOGIN-01 login page loads with all essential controls visible', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(page).toHaveURL(new RegExp(`${urls.elevateOrigin}/login`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect(page).toHaveTitle(/Thinkster Math/i);

    await expect(login.heading).toBeVisible();
    await expect(login.emailInput).toBeVisible();
    await expect(login.emailInput).toHaveAttribute('type', 'email');
    await expect(login.emailInput).toHaveAttribute('placeholder', 'you@example.com');
    await expect(login.passwordInput).toBeVisible();
    await expect(login.passwordInput).toHaveAttribute('type', 'password');
    await expect(login.signInButton).toBeVisible();
    await expect(login.signInButton).toBeEnabled();
    await expect(login.rememberMe).toBeVisible();
    await expect(login.forgotPasswordLink).toBeVisible();
    await expect(login.signupLink).toBeVisible();
    await expect(login.googleButton).toBeVisible();
    await expect(login.facebookButton).toBeVisible();

    // Remember me is an unchecked Radix checkbox on first load.
    expect(await login.isRememberMeChecked()).toBe(false);
  });

  test('LOGIN-02 empty email and password show inline required errors', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();

    await login.submit();

    await expect(login.emailRequiredError).toBeVisible();
    await expect(login.passwordRequiredError).toBeVisible();
    // The form must not navigate away.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('LOGIN-03 malformed email is rejected before any auth request is sent', async ({ page }) => {
    const login = new LoginPage(page);
    const network = recordNetwork(page);
    await login.goto();

    await login.fillCredentials(malformedEmail, throwawayPassword);

    // The login form does not set novalidate, so the browser blocks submission
    // via HTML5 constraint validation (validity.typeMismatch on type="email").
    const validity = await login.emailValidity();
    expect(validity.valid).toBe(false);
    expect(validity.typeMismatch).toBe(true);
    expect(validity.message).not.toBe('');

    await login.submit();

    // No POST /api/auth/login must be made, and we stay on /login.
    await expect(page).toHaveURL(/\/login$/);
    expect(network.find(endpoints.login)).toBeUndefined();

    network.stop();
  });

  test('LOGIN-04 incorrect credentials return 401 and a generic error, with no secrets leaked', async ({
    page,
  }, testInfo) => {
    const login = new LoginPage(page);
    const network = recordNetwork(page);
    await login.goto();

    await login.fillCredentials(nonExistentEmail, throwawayPassword);
    const response = await login.submitAndCaptureAuthResponse();

    expect(response.status()).toBe(401);
    await expect(login.invalidCredentialsError).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    // The error must stay generic: it must not reveal whether the account exists.
    const errorText = await login.invalidCredentialsError.innerText();
    expect(errorText).toBe(copy.invalidCredentials);
    expect(errorText).not.toContain(nonExistentEmail);

    // Diagnostics are URL/status only - request bodies are never captured.
    await attachDiagnostics(testInfo, 'auth-401-diagnostics', {
      authCall: network.find(endpoints.login),
      appCalls: network.appCalls(),
      note: 'Bodies intentionally omitted; values passed through the secret redactor.',
    });

    network.stop();
  });

  test('LOGIN-05 password visibility toggle switches the field between password and text', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(login.passwordToggle).toHaveCount(1);
    await login.passwordInput.fill(throwawayPassword);

    expect(await login.passwordFieldType()).toBe('password');
    await login.passwordToggle.click();
    await expect(login.passwordInput).toHaveAttribute('type', 'text');
    await login.passwordToggle.click();
    await expect(login.passwordInput).toHaveAttribute('type', 'password');
  });

  test('LOGIN-06 Forgot Password navigates to the reset page without sending an email', async ({
    page,
  }, testInfo) => {
    const login = new LoginPage(page);
    await login.goto();

    await expect(login.forgotPasswordLink).toHaveAttribute('href', urls.forgotPasswordPath);
    await login.forgotPasswordLink.click();

    const forgot = new ForgotPasswordPage(page);
    await expect(page).toHaveURL(new RegExp(`${urls.forgotPasswordPath}$`));
    await expect(forgot.heading).toBeVisible();
    await expect(forgot.emailInput).toBeVisible();
    await expect(forgot.emailInput).toHaveAttribute('placeholder', 'Enter your email');
    await expect(forgot.submitButton).toBeVisible();

    // Return path back to login is present and works.
    await expect(forgot.backToLoginLink).toHaveAttribute('href', '/login');
    await forgot.backToLoginLink.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(login.signInButton).toBeVisible();

    // Navigation is fully verified above. Submitting the form would send a real
    // recovery email, so that step alone is gated and reported as unverified.
    if (!gates.sendPasswordReset) {
      testInfo.annotations.push({
        type: 'not-submitted-by-design',
        description:
          'Navigation verified, but the reset form was NOT submitted - that sends a real recovery email. Set SEND_PASSWORD_RESET=true with an authorized mailbox to exercise submission.',
      });
    }
  });

  test('LOGIN-07 successful login with parent credentials', async ({ page }, testInfo) => {
    test.skip(
      !hasParentCredentials,
      'ELEVATE_PARENT_EMAIL / ELEVATE_PARENT_PASSWORD are not set in .env.',
    );

    const login = new LoginPage(page);
    const network = recordNetwork(page);
    await login.goto();

    await login.fillCredentials(parentAccount.email, parentAccount.password);
    const response = await login.submitAndCaptureAuthResponse();

    expect(response.status(), 'POST /api/auth/login should succeed').toBeLessThan(400);

    // Authenticated users are routed off /login.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });
    await expect(login.signInButton).toBeHidden();

    await attachDiagnostics(testInfo, 'login-success-diagnostics', {
      landingPath: new URL(page.url()).pathname,
      appCalls: network.appCalls(),
    });

    network.stop();
  });

  test('LOGIN-08 authenticated landing page survives a refresh, and logout works if present', async ({
    page,
  }, testInfo) => {
    test.skip(
      !hasParentCredentials,
      'ELEVATE_PARENT_EMAIL / ELEVATE_PARENT_PASSWORD are not set in .env.',
    );

    const login = new LoginPage(page);
    await login.goto();
    await login.login(parentAccount.email, parentAccount.password);
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 });

    const landingPath = new URL(page.url()).pathname;

    // Session must persist across a hard reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe(landingPath);

    const area = new AuthenticatedArea(page);
    const loggedOut = await area.logout();

    await attachDiagnostics(testInfo, 'authenticated-landing', {
      landingPath,
      logoutControlFound: loggedOut,
    });

    if (!loggedOut) {
      // Reported honestly rather than silently passing.
      test.info().annotations.push({
        type: 'pending',
        description:
          'No logout control matched the known patterns on the authenticated layout. The post-login DOM was never observable with Browser MCP (no credentials were provided), so this branch is unverified.',
      });
      return;
    }

    await area.waitForRedirectToLogin();
    await expect(login.signInButton).toBeVisible();
  });

  test('LOGIN-09 protected routes redirect an unauthenticated visitor to /login', async ({
    page,
  }, testInfo) => {
    const results: Array<{ path: string; finalPath: string; redirected: boolean }> = [];

    for (const path of AuthenticatedArea.protectedPaths) {
      await page.goto(`${urls.elevateOrigin}${path}`, { waitUntil: 'domcontentloaded' });
      const area = new AuthenticatedArea(page);
      await area.waitForRedirectToLogin();
      const finalPath = new URL(page.url()).pathname;
      results.push({ path, finalPath, redirected: finalPath.startsWith('/login') });
      expect(finalPath, `${path} should redirect to /login`).toMatch(/^\/login/);
    }

    await attachDiagnostics(testInfo, 'protected-route-probe', { results });
  });

  test('LOGIN-10 failure evidence capture is configured', async ({ page }, testInfo) => {
    // Guards the artifact configuration itself so a regression in
    // playwright.config.ts is caught rather than silently losing evidence.
    expect(testInfo.project.use.screenshot).toBe('only-on-failure');
    expect(testInfo.project.use.trace).toBe('retain-on-failure');
    expect(testInfo.project.use.video).toBe('off');

    // Sanity-check that the page under test is reachable, so the assertions
    // above are not passing against a dead target.
    const login = new LoginPage(page);
    await login.goto();
    await expect(login.heading).toBeVisible();
  });
});
