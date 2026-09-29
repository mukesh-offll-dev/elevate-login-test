/**
 * Jenkinsfile — Thinkster sandbox QA / Elevate login test suite
 *
 * Runs tests/login.spec.ts on a Windows Jenkins agent every 30 minutes.
 *
 * ─── JENKINS CREDENTIALS REQUIRED ──────────────────────────────────────────
 * Create every item below in Manage Jenkins → Credentials → System →
 * Global credentials → Add Credential  (Kind = Secret text for all of them).
 *
 *  ID                         Variable injected             Notes
 *  ─────────────────────────  ────────────────────────────  ──────────────────
 *  elevate-parent-email       ELEVATE_PARENT_EMAIL          Parent login email
 *  elevate-parent-password    ELEVATE_PARENT_PASSWORD       Legacy name (login suite)
 *  parent-password            PARENT_PASSWORD               Sandbox-aligned name
 *  thinkster-qa-bypass        THINKSTER_QA_BYPASS           Sandbox bypass header
 *  sandbox-otp                SANDBOX_OTP                   Fixed sandbox OTP
 *  sandbox-card-number        SANDBOX_CARD_NUMBER           Visa sandbox PAN
 *  sandbox-card-expiry        SANDBOX_CARD_EXPIRY           e.g. 12/30
 *  sandbox-card-cvc           SANDBOX_CARD_CVC              3-digit CVC
 *
 * All bindings use optional: true — a missing credential leaves the variable
 * empty rather than aborting the build.  Tests that require a credential will
 * skip automatically when it is absent (the existing hasParentCredentials /
 * hasTestCard guards in test-data.ts handle this).
 *
 * ─── DESTRUCTIVE GATES ──────────────────────────────────────────────────────
 * RUN_LIVE_SIGNUP, RUN_PAYMENT, ALLOW_UNIQUE_EMAIL and SEND_PASSWORD_RESET are
 * all pinned to false.  They are never enabled in scheduled CI runs.
 */
pipeline {
    agent any

    options {
        // Drop a queued trigger while a build is already running.
        disableConcurrentBuilds()

        // Keep the last 30 builds and their artifacts.
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))

        // 30 minutes gives headroom for slow network and reCAPTCHA delays.
        // The full login suite (10 tests, 2 CI workers, 1 retry each) normally
        // finishes in under 10 minutes.
        timeout(time: 30, unit: 'MINUTES')

        // Prefix every console line with a wall-clock timestamp.
        timestamps()
    }

    triggers {
        // Run every 30 minutes.  H spreads load across the hour so jobs do not
        // all start at exactly :00 and :30 simultaneously.
        cron('H/30 * * * *')
    }

    environment {
        // ── CI flags ────────────────────────────────────────────────────────
        // playwright.config.ts branches on CI:
        //   retries=1, workers=2, forbidOnly=true
        CI = 'true'

        // Use system-installed Google Chrome.  playwright.config.ts reads
        // BROWSER_CHANNEL and falls back to 'chrome' when unset.
        BROWSER_CHANNEL = 'chrome'

        // Skip FFmpeg dependency entirely.
        VIDEO = 'off'

        // Prevent any postinstall hook from downloading Playwright browser
        // binaries.  The suite uses system Chrome; no download is needed.
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

        // ── Target URLs (non-secret) ─────────────────────────────────────────
        SANDBOX_BASE_URL       = 'https://sandbox.hellothinkster.com'
        ELEVATE_STUDENTS_URL   = 'https://elevate-sandbox.hellothinkster.com/students'
        EXPECTED_PAYMENT_HOST  = 'cde.openpaystaging.com'
        ELEVATE_LOGIN_URL      = 'https://elevate.hellothinkster.com/login'
        FREE_TRIAL_URL         = 'https://www.hellothinkster.com/start/sign-up'

        // ── Non-secret parent / student / billing defaults ───────────────────
        PARENT_FIRST_NAME   = 'Test'
        PARENT_LAST_NAME    = 'Automation'
        PARENT_COUNTRY      = 'United States'
        PARENT_COUNTRY_CODE = '+1'
        PARENT_PHONE        = '(908) 020-4336'

        STUDENT_FIRST_NAME  = 'Test'
        STUDENT_GRADE       = '5'

        BILLING_POSTAL_CODE = '07001'
        BILLING_COUNTRY     = 'United States'

        // Timezone for the appointment picker.
        APPOINTMENT_TIMEZONE = 'America/New_York'

        // ── Approved test email domain ───────────────────────────────────────
        TEST_EMAIL_DOMAIN = 'tabtortest.com'

        // ── Destructive-action gates — always false in scheduled CI ──────────
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
            // Fails fast if Node.js / npm is not on the Jenkins service-account PATH.
            steps {
                bat 'node --version'
                bat 'npm --version'
            }
        }

        stage('Install Dependencies') {
            // npm ci installs exactly what is in package-lock.json.
            // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (set above) prevents any
            // implicit browser download during postinstall.
            steps {
                bat 'npm ci'
            }
        }

        stage('Clean Previous Results') {
            // Removes playwright-report/, test-results/ and artifacts/ so every
            // build starts from a clean state.
            steps {
                bat 'npm run clean'
            }
        }

        stage('Run Login Tests') {
            steps {
                // ── Inject all secrets from the Jenkins Credential Store ──────
                //
                // optional: true  →  if a credential ID does not yet exist in
                // Jenkins the variable is left as an empty string rather than
                // aborting the build.  Tests guard on the empty string via
                // hasParentCredentials / hasTestCard in test-data.ts and skip.
                //
                // Jenkins masks every bound value in console output automatically.
                // The diagnostics.ts redaction layer provides a second layer of
                // protection inside Playwright JSON artifacts and traces.
                withCredentials([
                    // Parent login
                    string(credentialsId: 'elevate-parent-email',
                           variable: 'ELEVATE_PARENT_EMAIL',
                           optional: true),
                    // Both names for the parent password: ELEVATE_PARENT_PASSWORD
                    // is read by the existing login suite (test-data.ts:69);
                    // PARENT_PASSWORD is the sandbox-aligned name used by newer tests.
                    string(credentialsId: 'elevate-parent-password',
                           variable: 'ELEVATE_PARENT_PASSWORD',
                           optional: true),
                    string(credentialsId: 'parent-password',
                           variable: 'PARENT_PASSWORD',
                           optional: true),

                    // Sandbox bypass header — suppresses bot-detection / rate-limiting
                    // in the sandbox environment.  Never used against production.
                    string(credentialsId: 'thinkster-qa-bypass',
                           variable: 'THINKSTER_QA_BYPASS',
                           optional: true),

                    // Sandbox OTP (fixed value in sandbox, never a real OTP)
                    string(credentialsId: 'sandbox-otp',
                           variable: 'SANDBOX_OTP',
                           optional: true),

                    // Sandbox test card (Visa PAN 4111111111111111 is publicly
                    // documented; treat as secret anyway to match the redactor).
                    // Both the new sandbox-aligned names and the legacy names are
                    // bound so either can be used depending on which test reads them.
                    string(credentialsId: 'sandbox-card-number',
                           variable: 'SANDBOX_CARD_NUMBER',
                           optional: true),
                    string(credentialsId: 'sandbox-card-expiry',
                           variable: 'SANDBOX_CARD_EXPIRY',
                           optional: true),
                    string(credentialsId: 'sandbox-card-cvc',
                           variable: 'SANDBOX_CARD_CVC',
                           optional: true),

                    // Legacy names kept for test-data.ts backward compatibility
                    string(credentialsId: 'sandbox-card-number',
                           variable: 'TEST_CARD_NUMBER',
                           optional: true),
                    string(credentialsId: 'sandbox-card-expiry',
                           variable: 'TEST_CARD_EXPIRY',
                           optional: true),
                    string(credentialsId: 'sandbox-card-cvc',
                           variable: 'TEST_CARD_CVC',
                           optional: true)
                ]) {
                    // npm run test:login expands to:
                    //   playwright test tests/login.spec.ts
                    // Reporters (list + HTML + JUnit) are configured in
                    // playwright.config.ts and do not need repeating here.
                    bat 'npm run test:login'
                }
            }
        }
    }

    post {
        always {
            // Publish JUnit XML so Jenkins renders a test-result trend graph and
            // per-test pass/fail history.
            // Path matches playwright.config.ts line 28:
            //   ['junit', { outputFile: 'artifacts/junit-results.xml' }]
            junit testResults: 'artifacts/junit-results.xml',
                  allowEmptyResults: true

            // Archive HTML report, Playwright traces/screenshots and redacted
            // diagnostics JSON files as downloadable build artifacts.
            archiveArtifacts artifacts: [
                'playwright-report/**',
                'test-results/**',
                'artifacts/**'
            ].join(','),
            allowEmptyArchive: true

            // Publish the Playwright HTML report as an inline Jenkins page.
            // Requires the HTML Publisher plugin.
            // NOTE: Jenkins' default CSP blocks the JS inside the report.
            // See setup instructions for the one-time Script Console fix.
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
            // Kill any Chrome processes left behind by Playwright after a crash.
            // Safe: the Jenkins service account has no interactive Chrome session.
            // /T also kills child processes (renderer, GPU helper).
            // "& exit /b 0" ensures this step never overwrites the real build
            // result when there is nothing to kill (taskkill exits 128 when the
            // process is not found).
            bat 'taskkill /F /IM chrome.exe /T 2>nul & exit /b 0'
        }
    }
}
