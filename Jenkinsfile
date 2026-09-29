/**
 * Jenkinsfile — Thinkster sandbox QA / Elevate login test suite
 *
 * Runs tests/login.spec.ts on a Windows Jenkins agent every 30 minutes.
 *
 * ─── JENKINS CREDENTIALS REQUIRED ──────────────────────────────────────────
 * Create every entry below in Manage Jenkins → Credentials → System →
 * Global credentials → Add Credential  (Kind = Secret text for all).
 *
 * Every credential ID listed here MUST exist in Jenkins before the first run,
 * even if its value is left blank. A missing credential ID causes a build
 * failure before any test runs.  Blank values are safe: the existing guards in
 * test-data.ts (hasParentCredentials, hasTestCard) evaluate to false and the
 * matching tests skip automatically.
 *
 *  Credential ID               Variable(s) injected        Safe to leave blank?
 *  ──────────────────────────  ──────────────────────────  ────────────────────
 *  elevate-parent-email        ELEVATE_PARENT_EMAIL        Yes → LOGIN-07/08 skip
 *  elevate-parent-password     ELEVATE_PARENT_PASSWORD     Yes → LOGIN-07/08 skip
 *  parent-password             PARENT_PASSWORD             Yes (not read by current tests)
 *  thinkster-qa-bypass         THINKSTER_QA_BYPASS         Yes (not read by current tests)
 *  sandbox-otp                 SANDBOX_OTP                 Yes (only used in fixme tests)
 *  sandbox-card-number         SANDBOX_CARD_NUMBER         Yes → payment tests gated off
 *                              TEST_CARD_NUMBER
 *  sandbox-card-expiry         SANDBOX_CARD_EXPIRY         Yes
 *                              TEST_CARD_EXPIRY
 *  sandbox-card-cvc            SANDBOX_CARD_CVC            Yes
 *                              TEST_CARD_CVC
 *
 * NOTE: optional:true is NOT used here because it requires Credentials Binding
 * Plugin ≥ 1.24.  Instead, all credentials must exist in Jenkins.  An empty
 * string value is functionally identical to "not set" for these tests.
 *
 * ─── DESTRUCTIVE GATES ──────────────────────────────────────────────────────
 * RUN_LIVE_SIGNUP, RUN_PAYMENT, ALLOW_UNIQUE_EMAIL and SEND_PASSWORD_RESET are
 * all pinned to false.  They must never be changed in scheduled CI runs.
 */
pipeline {
    agent any

    options {
        // Drop a queued trigger while a build is already running.
        disableConcurrentBuilds()

        // Keep the last 30 builds and their artifacts.
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))

        // 30-minute hard ceiling.  The full login suite (10 tests, 2 CI workers,
        // 1 retry each) normally finishes in under 10 minutes.
        timeout(time: 30, unit: 'MINUTES')

        // Prefix every console line with a wall-clock timestamp.
        timestamps()
    }

    triggers {
        // H spreads load across the half-hour so all jobs don't fire at :00/:30.
        cron('H/30 * * * *')
    }

    environment {
        // ── CI flags ────────────────────────────────────────────────────────
        // playwright.config.ts branches on CI:
        //   retries=1, workers=2, forbidOnly=true
        CI = 'true'

        // Use system-installed Google Chrome.
        BROWSER_CHANNEL = 'chrome'

        // Skip FFmpeg dependency entirely.
        VIDEO = 'off'

        // Prevent any postinstall hook from downloading Playwright browser
        // binaries. System Chrome is used; no download is needed.
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

        // ── Target URLs (non-secret) ─────────────────────────────────────────
        SANDBOX_BASE_URL       = 'https://sandbox.hellothinkster.com'
        ELEVATE_STUDENTS_URL   = 'https://elevate-sandbox.hellothinkster.com/students'
        EXPECTED_PAYMENT_HOST  = 'cde.openpaystaging.com'
        ELEVATE_LOGIN_URL      = 'https://elevate.hellothinkster.com/login'
        FREE_TRIAL_URL         = 'https://www.hellothinkster.com/start/sign-up'

        // ── Non-secret parent / student / billing defaults ───────────────────
        // These mirror .env.example and are not sensitive.
        PARENT_FIRST_NAME   = 'Test'
        PARENT_LAST_NAME    = 'Automation'
        PARENT_COUNTRY      = 'United States'
        PARENT_COUNTRY_CODE = '+1'
        PARENT_PHONE        = '(908) 020-4336'

        STUDENT_FIRST_NAME  = 'Test'
        STUDENT_GRADE       = '5'

        BILLING_POSTAL_CODE = '07001'
        BILLING_COUNTRY     = 'United States'

        APPOINTMENT_TIMEZONE = 'America/New_York'

        // ── Approved test email domain ───────────────────────────────────────
        TEST_EMAIL_DOMAIN = 'tabtortest.com'

        // ── Destructive-action gates — always false in scheduled CI ──────────
        // These must never be changed here without an authorized sandbox account.
        RUN_LIVE_SIGNUP     = 'false'
        RUN_PAYMENT         = 'false'
        ALLOW_UNIQUE_EMAIL  = 'false'
        SEND_PASSWORD_RESET = 'false'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Verify Tools') {
            // Fails fast if Node.js or npm is not on the Jenkins service-account PATH.
            // See setup documentation for how to add Node to the system PATH on Windows.
            steps {
                bat 'node --version'
                bat 'npm --version'
            }
        }

        stage('Install Dependencies') {
            // npm ci installs exactly what is in package-lock.json.
            // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (set above) prevents any browser
            // binary download during postinstall.
            steps {
                bat 'npm ci'
            }
        }

        stage('Clean Previous Results') {
            // Removes playwright-report/, test-results/ and artifacts/ so every
            // build starts from a clean state.
            // The clean script is defined in package.json and uses Node's fs.rmSync.
            steps {
                bat 'npm run clean'
            }
        }

        stage('Run Login Tests') {
            steps {
                // ── Inject secrets from the Jenkins Credential Store ──────────
                //
                // All credential IDs below MUST exist in Jenkins.
                // Create them under Manage Jenkins → Credentials even if the
                // secret value is left blank — an empty string causes the
                // dependent tests to skip rather than fail.
                //
                // Jenkins automatically masks every bound value in console output.
                // The diagnostics.ts redact() function provides a second layer of
                // protection inside Playwright JSON artifacts and traces.
                //
                // optional:true is intentionally absent; it requires Credentials
                // Binding Plugin ≥ 1.24 and produces "Unknown parameter: optional"
                // on older installations.
                withCredentials([
                    // ── Parent login (gates LOGIN-07 and LOGIN-08) ────────────
                    string(credentialsId: 'elevate-parent-email',
                           variable: 'ELEVATE_PARENT_EMAIL'),
                    string(credentialsId: 'elevate-parent-password',
                           variable: 'ELEVATE_PARENT_PASSWORD'),

                    // ── Sandbox password alias (not read by current login tests)
                    string(credentialsId: 'parent-password',
                           variable: 'PARENT_PASSWORD'),

                    // ── QA bypass header (sandbox environments only) ──────────
                    string(credentialsId: 'thinkster-qa-bypass',
                           variable: 'THINKSTER_QA_BYPASS'),

                    // ── Sandbox OTP (used only in test.fixme stubs) ───────────
                    string(credentialsId: 'sandbox-otp',
                           variable: 'SANDBOX_OTP'),

                    // ── Sandbox test card (gated behind RUN_PAYMENT=false) ────
                    // Dual-bound: test-data.ts reads TEST_CARD_* (legacy names);
                    // SANDBOX_CARD_* are the sandbox-aligned names for future tests.
                    string(credentialsId: 'sandbox-card-number',
                           variable: 'SANDBOX_CARD_NUMBER'),
                    string(credentialsId: 'sandbox-card-number',
                           variable: 'TEST_CARD_NUMBER'),
                    string(credentialsId: 'sandbox-card-expiry',
                           variable: 'SANDBOX_CARD_EXPIRY'),
                    string(credentialsId: 'sandbox-card-expiry',
                           variable: 'TEST_CARD_EXPIRY'),
                    string(credentialsId: 'sandbox-card-cvc',
                           variable: 'SANDBOX_CARD_CVC'),
                    string(credentialsId: 'sandbox-card-cvc',
                           variable: 'TEST_CARD_CVC')
                ]) {
                    // npm run test:login expands to:
                    //   playwright test tests/login.spec.ts
                    // Reporters (list + HTML + JUnit) are declared in
                    // playwright.config.ts and must not be repeated here.
                    bat 'npm run test:login'
                }
            }
        }
    }

    post {
        always {
            // Publish JUnit XML so Jenkins renders a test-result trend graph and
            // per-test pass/fail history on the build page.
            // Path is declared in playwright.config.ts:
            //   ['junit', { outputFile: 'artifacts/junit-results.xml' }]
            junit testResults: 'artifacts/junit-results.xml',
                  allowEmptyResults: true

            // Archive HTML report, Playwright traces/screenshots and redacted
            // diagnostics JSON as downloadable build artifacts.
            archiveArtifacts artifacts: [
                'playwright-report/**',
                'test-results/**',
                'artifacts/**'
            ].join(','),
            allowEmptyArchive: true

            // Publish the Playwright HTML report as an inline Jenkins page.
            // Requires the HTML Publisher plugin.
            // IMPORTANT: Jenkins' default Content Security Policy blocks the
            // JavaScript inside Playwright's HTML report. Run the one-time
            // Script Console fix described in the setup documentation.
            publishHTML(target: [
                allowMissing         : true,
                alwaysLinkToLastBuild: true,
                keepAll              : true,
                reportDir            : 'playwright-report',
                reportFiles          : 'index.html',
                reportName           : 'Playwright Report'
            ])
        }

        cleanup {
            // Kill any Chrome processes left behind by a crashed Playwright run.
            // Safe: the Jenkins service account has no interactive Chrome sessions.
            // /T also terminates child processes (renderer, GPU helper).
            // "& exit /b 0" prevents a non-zero exit code from overwriting the
            // real build result when there is nothing to kill (taskkill exits 128
            // when the named process is not found).
            bat 'taskkill /F /IM chrome.exe /T 2>nul & exit /b 0'
        }
    }
}
