# Browser tests

Playwright tests that use every tool on the live site with real files, check the downloaded outputs, and record console errors, failed requests and screenshots. This folder lives on the `test/playwright-e2e` branch only and is not meant for `main`.

## On GitHub

Every push to `test/playwright-e2e` runs the tests (workflow "Browser tests"). You can also start it from the Actions tab and point it at another URL. Results appear in the run summary, as a `browser-test-results` artifact, and on the `test/playwright-e2e-results` branch (report, screenshots and outputs).

## On your machine (PowerShell)

```powershell
git fetch origin test/playwright-e2e
git switch test/playwright-e2e
cd e2e
npm install
npx playwright install chromium
node run.mjs
```

Pass a URL to test something else, such as a local server: `node run.mjs http://localhost:8000/`.

To test HEIC, put a `.heic` file in `fixtures/extra/`.
