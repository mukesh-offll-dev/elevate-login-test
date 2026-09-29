import { expect, type Locator, type Page } from '@playwright/test';
import { assertApprovedEmail, urls } from '../utils/test-data';

/**
 * Page object for the real Thinkster free-trial signup funnel.
 *
 * VERIFIED WITH BROWSER MCP / LIVE PLAYWRIGHT PROBES ON 2026-09-28
 * ================================================================
 *
 * ENTRY POINT
 *   The Elevate login page link "Sign up for a free trial" points at
 *     https://hellothinkster.com/start/sign-up.html
 *   which resolves through two 308 redirects to
 *     https://www.hellothinkster.com/start/sign-up
 *   (title "Registration | Thinkster Online Math Coaching").
 *   The FREE_TRIAL_URL in the original brief was truncated and is not valid.
 *
 * !! THE PAGE IS A/B TESTED !!
 *   Two different funnels are served at random (~50/50, Statsig-driven; no
 *   forcing cookie or query parameter was found). Element IDs differ between
 *   them, so this page object detects the variant first and never assumes one.
 *
 *   VARIANT "free-trial"  - heading "Get started with your free trial"
 *     step 1  #twVAEmail (label "Parent email address")
 *             #twCtaVAStart   "Continue" (disabled while email is empty)
 *             #twVAGoogleBtn "Sign up with Google" / #twVAFbBtn "Sign up with Facebook"
 *     step 2  "Tell us about yourself"
 *             #twVAFirst      label "First name"    placeholder "Your first name"
 *             #twVALast       label "Last name"     placeholder "Your last name"
 *             #twVAPhone      label "Cell phone - we'll text a code to verify it"
 *                             placeholder "(555) 000-0000"; 9080204336 -> "(908) 020-4336"
 *             #twCcBtn        country-code button, opens a list with #twCcSearch
 *             #twVASmsConsent SMS/AI-call consent (does NOT gate Continue)
 *             #twVAPw         placeholder "At least 8 characters"
 *             #twVAPwCount    live counter "N/8 characters"
 *             #twVABack       "Back" (returns to step 1, preserves the email)
 *             #twCtaVAAbout   "Continue"  <-- ACCOUNT-CREATION BOUNDARY, never clicked
 *             Gating: first + last + 10-digit phone + password >= 8 chars.
 *             Boundary confirmed: 7 chars disabled, exactly 8 enabled.
 *
 *   VARIANT "accelerator" - heading "The Math Confidence Accelerator System"
 *     step 1  #twEmailFld (placeholder "Parent email address")
 *             #twCtaLanding  "Start" (disabled while email is empty)
 *             #twGoogleBtn "Continue with Google" / #twFbBtn "Continue with Facebook"
 *     step 2  "You just did the hard part."  #twCtaCongrats / #twSkipVid "Skip the video"
 *     step 3  "How many children are you exploring Thinkster for?"  1/2/3  #twCtaCount
 *     step 4  "Let's start your child at exactly the right level."
 *             #twNameFld  placeholder "First name"            <-- STUDENT INFORMATION
 *             #axis1 + #hSchool  role=slider aria-label "School grade"  (0..11)
 *             #axis2 + #hWork    role=slider aria-label "Working grade" (0..11)
 *             #twV1 / #twV2      selected value, e.g. "Grade 5"         <-- GRADE SELECTION
 *             Ticks: K 1 2 3 4 5 6 7 8 AL1 AL2 (div.sp-tlab inside the axis).
 *             Clicking a tick sets the grade; the handle also responds to ArrowRight.
 *             #twCtaGrade  label morphs "Add their name" -> "Answer question 1"
 *                          -> "Next question" -> "Continue"
 *     step 5  "What's the one thing you want to change for <child>?"  #twCtaQ1
 *             (disabled until a goal option is chosen; personalised with the
 *             student's first name, proving step 4 data propagates)
 *
 * SHARED
 *   No <form> element exists - the funnel is entirely JS-driven.
 *   Invisible reCAPTCHA (site key 6Lc4XnYsAAAAAODq0svz1csIi7-fUCynO2pTOsP5)
 *   loads on the first step transition and fills textarea[name=g-recaptcha-response].
 *   A hidden pricing sheet is present in both variants:
 *     #twSheet.tw-sheet.pricing-plans ("Your plan options")
 *     children #twCloseSheet #twSegBill #twPerChildLab #twChildPlans
 *              #twSumName #twSumPrice #twSumSib     - no card fields.
 *
 * !! SIDE EFFECT ON LEAVING STEP 1 !!
 *   Clicking the step 1 CTA issues
 *     POST https://core-api-4.0.hellothinkster.com/api/register/lead
 *     POST https://core-api-4.0.hellothinkster.com/api/registration/step-progress/v2
 *   so step 1 - not step 2 - is the first server-side write. Every method that
 *   leaves step 1 is therefore gated behind RUN_LIVE_SIGNUP=true in the specs.
 *
 * NOT OBSERVED ANYWHERE
 *   OTP entry, billing/card capture and subscription activation. No OTP,
 *   Stripe, checkout or billing endpoint appears in the page scripts, and no
 *   such control was rendered in either variant before the account-creation
 *   boundary. Those cases are reported as pending, never as passing.
 */
export type SignupVariant = 'free-trial' | 'accelerator' | 'unknown';

export class SignupPage {
  readonly page: Page;

  /** Variant-neutral step 1 controls (both ID sets are tried). */
  readonly emailInput: Locator;
  readonly step1Continue: Locator;
  readonly googleButton: Locator;
  readonly facebookButton: Locator;
  readonly recaptchaNotice: Locator;
  readonly recaptchaTokenField: Locator;

  /** "free-trial" variant: step 2 "Tell us about yourself". */
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly phoneInput: Locator;
  readonly countryCodeButton: Locator;
  readonly countryCodeSearch: Locator;
  readonly smsConsentCheckbox: Locator;
  readonly passwordInput: Locator;
  readonly passwordCounter: Locator;
  readonly backButton: Locator;
  readonly aboutYouContinue: Locator;

  /** "accelerator" variant: interstitial, child count, student + grade, goal. */
  readonly congratsContinue: Locator;
  readonly skipVideoButton: Locator;
  readonly childCountContinue: Locator;
  readonly studentFirstNameInput: Locator;
  readonly schoolGradeSlider: Locator;
  readonly workingGradeSlider: Locator;
  readonly schoolGradeAxis: Locator;
  readonly workingGradeAxis: Locator;
  readonly schoolGradeValue: Locator;
  readonly workingGradeValue: Locator;
  readonly gradeContinue: Locator;
  readonly goalContinue: Locator;

  /** Pricing sheet, present but hidden in both variants. */
  readonly pricingSheet: Locator;
  readonly pricingSheetClose: Locator;
  readonly pricingSheetPlans: Locator;

  /** Public reCAPTCHA site key from the anchor iframe URL. Not a secret. */
  static readonly recaptchaSiteKey = '6Lc4XnYsAAAAAODq0svz1csIi7-fUCynO2pTOsP5';

  static readonly headings = {
    freeTrial: 'Get started with your free trial',
    accelerator: 'The Math Confidence Accelerator System',
    aboutYou: 'Tell us about yourself',
    congrats: 'You just did the hard part.',
    childCount: 'How many children are you exploring Thinkster for?',
    studentLevel: "Let's start your child at exactly the right level.",
  } as const;

  constructor(page: Page) {
    this.page = page;

    this.emailInput = page.locator('#twVAEmail, #twEmailFld');
    this.step1Continue = page.locator('#twCtaVAStart, #twCtaLanding');
    this.googleButton = page.locator('#twVAGoogleBtn, #twGoogleBtn');
    this.facebookButton = page.locator('#twVAFbBtn, #twFbBtn');
    this.recaptchaNotice = page
      .getByText('This site is protected by reCAPTCHA', { exact: false })
      .first();
    this.recaptchaTokenField = page.locator('textarea[name="g-recaptcha-response"]');

    this.firstNameInput = page.locator('#twVAFirst');
    this.lastNameInput = page.locator('#twVALast');
    this.phoneInput = page.locator('#twVAPhone');
    this.countryCodeButton = page.locator('#twCcBtn');
    this.countryCodeSearch = page.locator('#twCcSearch');
    this.smsConsentCheckbox = page.locator('#twVASmsConsent');
    this.passwordInput = page.locator('#twVAPw');
    this.passwordCounter = page.locator('#twVAPwCount');
    this.backButton = page.locator('#twVABack');
    this.aboutYouContinue = page.locator('#twCtaVAAbout');

    this.congratsContinue = page.locator('#twCtaCongrats');
    this.skipVideoButton = page.locator('#twSkipVid');
    this.childCountContinue = page.locator('#twCtaCount');
    this.studentFirstNameInput = page.locator('#twNameFld');
    this.schoolGradeSlider = page.getByRole('slider', { name: 'School grade' });
    this.workingGradeSlider = page.getByRole('slider', { name: 'Working grade' });
    this.schoolGradeAxis = page.locator('#axis1');
    this.workingGradeAxis = page.locator('#axis2');
    this.schoolGradeValue = page.locator('#twV1');
    this.workingGradeValue = page.locator('#twV2');
    this.gradeContinue = page.locator('#twCtaGrade');
    this.goalContinue = page.locator('#twCtaQ1');

    this.pricingSheet = page.locator('#twSheet');
    this.pricingSheetClose = page.locator('#twCloseSheet');
    this.pricingSheetPlans = page.locator('#twChildPlans');
  }

  async goto(): Promise<void> {
    await this.page.goto(urls.freeTrial, { waitUntil: 'domcontentloaded' });
    // The funnel is client-rendered; wait for the step 1 email box of either variant.
    await expect(this.emailInput).toBeVisible({ timeout: 45_000 });
  }

  /** Detects which A/B funnel was served for this page load. */
  async variant(): Promise<SignupVariant> {
    if (await this.page.locator('#twVAEmail').count()) return 'free-trial';
    if (await this.page.locator('#twEmailFld').count()) return 'accelerator';
    return 'unknown';
  }

  /** Step 1 CTA label differs per variant ("Continue" vs "Start"). */
  async step1ContinueLabel(): Promise<string> {
    return (await this.step1Continue.innerText()).trim();
  }

  async isOnStep1(): Promise<boolean> {
    return this.emailInput.isVisible().catch(() => false);
  }

  /** Fills the email and waits for the CTA to become enabled. No click. */
  async enterEmail(email: string): Promise<void> {
    // Refuses anything outside the approved test domain, because the next click
    // would turn this address into a real lead.
    await this.emailInput.fill(assertApprovedEmail(email));
    await expect(this.step1Continue).toBeEnabled({ timeout: 10_000 });
  }

  /**
   * DESTRUCTIVE: POSTs /api/register/lead and leaves step 1.
   * Callers must gate this behind RUN_LIVE_SIGNUP=true.
   * Resolves once the next screen of whichever variant is active is visible.
   */
  async submitStep1(): Promise<SignupVariant> {
    // Second guard: never advance with an address off the approved test domain.
    assertApprovedEmail(await this.emailInput.inputValue());
    const variant = await this.variant();
    await this.step1Continue.click();
    if (variant === 'free-trial') {
      await expect(this.firstNameInput).toBeVisible({ timeout: 45_000 });
    } else {
      await expect(this.congratsContinue.or(this.skipVideoButton).first()).toBeVisible({
        timeout: 45_000,
      });
    }
    return variant;
  }

  // ---------------------------------------------------------------- free-trial
  async fillAboutYou(details: {
    firstName: string;
    lastName: string;
    phone: string;
    password: string;
    smsConsent?: boolean;
  }): Promise<void> {
    await this.firstNameInput.fill(details.firstName);
    await this.lastNameInput.fill(details.lastName);
    await this.phoneInput.fill(details.phone.replace(/\D/g, ''));
    await this.passwordInput.fill(details.password);
    if (details.smsConsent) {
      await this.smsConsentCheckbox.check({ force: true });
    }
  }

  async goBackToStep1(): Promise<void> {
    await this.backButton.click();
    await expect(this.emailInput).toBeVisible({ timeout: 20_000 });
  }

  async openCountryCodePicker(): Promise<void> {
    await this.countryCodeButton.click();
    await expect(this.countryCodeSearch).toBeVisible({ timeout: 15_000 });
  }

  // -------------------------------------------------------------- accelerator
  /** Skips the interstitial video and lands on the child-count question. */
  async passInterstitial(): Promise<void> {
    await this.skipVideoButton.click();
    await expect(this.childCountContinue).toBeVisible({ timeout: 45_000 });
  }

  async chooseChildCount(count: 1 | 2 | 3): Promise<void> {
    await this.page
      .getByText(count === 1 ? 'child' : 'children', { exact: true })
      .nth(count - 1)
      .click()
      .catch(() => undefined);
    await this.childCountContinue.click();
    await expect(this.studentFirstNameInput).toBeVisible({ timeout: 45_000 });
  }

  async enterStudentName(firstName: string): Promise<void> {
    await this.studentFirstNameInput.fill(firstName);
  }

  /** Grade is a slider; clicking its axis tick is the user-facing way to set it. */
  async selectSchoolGrade(grade: string): Promise<void> {
    await this.schoolGradeAxis.locator('.sp-tlab', { hasText: new RegExp(`^${grade}$`) }).first().click();
    await expect(this.schoolGradeValue).not.toHaveText(/not set/i);
  }

  async selectWorkingGrade(grade: string): Promise<void> {
    await this.workingGradeAxis.locator('.sp-tlab', { hasText: new RegExp(`^${grade}$`) }).first().click();
    await expect(this.workingGradeValue).not.toHaveText(/not set/i);
  }

  async gradeAxisTicks(): Promise<string[]> {
    return this.schoolGradeAxis.locator('.sp-tlab').allInnerTexts();
  }

  // ------------------------------------------------------------------- shared
  /** Matches messages the site uses for an address that already has an account. */
  existingAccountMessage(): Locator {
    return this.page
      .getByText(/already (?:have|has|exists|registered)|account exists|sign in instead/i)
      .first();
  }
}

