/**
 * Jenkinsfile — Elevate Login Test Suite
 *
 * Runs tests/login.spec.ts on a Windows Jenkins agent every 30 minutes.
 *
 * CREDENTIALS REQUIRED (create in Manage Jenkins > Credentials before first run):
 *   elevate-parent-email    — Secret text, value: the parent account email
 *   elevate-parent-password — Secret text, value: the parent account password
 *
 * If either credential is absent or empty, LOGIN-07 and LOGIN-08 skip
 * automatically via the existing hasParentCredentials guard in test-data.ts.
 * All other login tests (LOGIN-01 through LOGIN-06, LOGIN-09, LOGIN-10)
 * run unconditionally and require no credentials.
 *
 * DESTRUCTIVE GATES: RUN_LIVE_SIGNUP, RUN_PAYMENT, ALLOW_UNIQUE_EMAIL and
 * SEND_PASSWORD_RESET are all pinned to false here. They are never enabled
 * in scheduled CI runs. Do not change them without explicit authorization.
 */
pipeline {
    agent any

    options {
        // Prevent overlapping scheduled builds. A queued trigger is dropped
        // while a build is already running.
        disableConcurrentBuilds()

        // Keep the last 30 builds and their artifacts.
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '30'))

        // Hard ceiling: the full login suite (10 tests, 2 workers, 1 retry each
        // on CI) completes well under 15 minutes under normal conditions.
        // 30 minutes gives headroom for slow network and reCAPTCHA delays.
        timeout(time: 30, unit: 'MINUTES')

        // Prepend a timestamp to every console line for easier diagnosis.
        timestamps()
    }

    triggers {
        // Run every 30 minutes. The H (hash) modifier spreads load across the
        // hour and avoids every job starting at :00 and :30 simultaneously.
        cron('H/30 * * * *')
    }

    environment {
        // Tell Playwright and the config that this is a CI run.
        // playwright.config.ts branches on CI: retries=1, workers=2, forbidOnly=true.
        CI = 'true'

        // Use the system-installed Google Chrome.
        // playwright.config.ts sets channel: process.env.BROWSER_CHANNEL || 'chrome',
        // so this is redundant but explicit.
        BROWSER_CHANNEL = 'chrome'

        // Disable video recording (avoids the FFmpeg dependency entirely).
        // Matches the default in .env.example.
        VIDEO = 'off'

        // Prevent any postinstall hook from downloading Playwright browser
        // binaries. The test suite uses system Chrome, so no download is needed.
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'

        // Non-secret target URLs — mirror .env.example defaults.
        ELEVATE_LOGIN_URL = 'https://elevate.hellothinkster.com/login'
        FREE_TRIAL_URL    = 'https://www.hellothinkster.com/start/sign-up'

        // Approved test email domain. Must match the .env.example default to
        // prevent accidental lead creation in Thinkster's CRM.
        TEST_EMAIL_DOMAIN = 'tabtortest.com'

        // Non-secret parent profile defaults used in gated step-2 tests.
        // These are intentionally benign and match .env.example.
        PARENT_FIRST_NAME   = 'Mukesh'
        PARENT_LAST_NAME    = 'Automation'
        PARENT_COUNTRY      = 'United States'
        PARENT_COUNTRY_CODE = '+1'

        // Destructive gates — always false in scheduled CI.
        // Never override these without an authorized sandbox account.
        RUN_LIVE_SIGNUP    = 'false'
        RUN_PAYMENT        = 'false'
        ALLOW_UNIQUE_EMAIL = 'false'
        SEND_PASSWORD_RESET = 'false'
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Verify Tools') {
            // Fail fast if Node.js or npm is not on the PATH for the Jenkins
            // service account. See SETUP NOTES below for how to configure this.
            steps {
                bat 'node --version'
                bat 'npm --version'
            }
        }

        stage('Install Dependencies') {
            // npm ci installs exactly what is in package-lock.json.
            // PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (set above) ensures no browser
            // binary download is attempted during postinstall.
            steps {
                bat 'npm ci'
            }
        }

        stage('Clean Previous Results') {
            // Removes playwright-report/, test-results/ and artifacts/ so every
            // build starts clean. The npm clean script is defined in package.json
            // and uses Node's fs.rmSync rather than platform-specific shell commands.
            steps {
                bat 'npm run clean'
            }
        }

        stage('Run Login Tests') {
            steps {
                // Inject parent credentials from Jenkins Credential Store.
                //
                // optional: true — if the credential ID does not exist in Jenkins,
                // the variable is left unset (empty string) rather than aborting
                // the build. This mirrors the local .env.example behaviour where
                // leaving the values blank causes LOGIN-07/08 to skip.
                //
                // The values are masked in the console log by Jenkins automatically.
                // The existing secret-redaction logic in diagnostics.ts further
                // prevents them from appearing in JSON artifacts or Playwright traces.
                withCredentials([
                    string(credentialsId: 'elevate-parent-email',
                           variable: 'ELEVATE_PARENT_EMAIL',
                           optional: true),
                    string(credentialsId: 'elevate-parent-password',
                           variable: 'ELEVATE_PARENT_PASSWORD',
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
            // Publish JUnit XML so Jenkins displays a test-result trend graph
            // and per-test pass/fail history on the build page.
            // Path matches playwright.config.ts: outputFile: 'artifacts/junit-results.xml'
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

            // Publish the Playwright HTML report as an inline Jenkins HTML page.
            // Requires the HTML Publisher plugin (see REQUIRED PLUGINS below).
            // NOTE: Jenkins' default Content Security Policy blocks the JavaScript
            // inside Playwright's HTML report. See SETUP NOTES for the one-time
            // System Groovy fix to relax it for this specific report.
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
            // Kill any Chrome processes left behind by Playwright if a test
            // crashed without closing its browser context.
            //
            // Safety: Jenkins runs under a dedicated service account that has no
            // interactive Chrome session, so this only targets automation-spawned
            // instances. The /T flag also kills child processes (renderer, GPU).
            //
            // "& exit /b 0" ensures this step always succeeds so it does not
            // overwrite the real build result when there is nothing to kill.
            bat 'taskkill /F /IM chrome.exe /T 2>nul & exit /b 0'
        }
    }
}
