# AGENTS.md

Static collection of browser-based utility tools. Everything runs client-side on the user's device — nothing is ever uploaded. Deployed as plain static files on GitHub Pages.

## Critical constraint

There is NO build step and NO package.json. This is deliberate. Vanilla HTML/CSS/JS only, ES modules, no bundler, no framework, no npm dependencies. Do not add tooling without asking first.

## Commands

- Local preview (required — workers, ES modules, and WASM fetch all fail on `file://`):
  `python -m http.server` from this directory, then open `http://localhost:8000`
- Syntax-check an ES module JS file (no package.json means `.js` defaults to CJS checking):
  copy to a temp `.mjs` file, then `node --check tempfile.mjs`
- Test qpdf-wasm engine changes in Node before shipping UI changes:
  `npm pack @neslinesli93/qpdf-wasm`, extract, then write a small `.cjs` script that loads the dist glue via `require()`, writes PDF bytes with `q.FS.writeFile()`, runs `q.callMain([...])`, and reads results with `q.FS.readFile()`. Test with real encrypted PDFs made by pikepdf (user password, wrong password, owner-only, unencrypted).
- PowerShell gotcha: inline `node -e "..."` breaks on quoting. Always write test scripts to files instead.

## Architecture

```
index.html                          home page: hero + tool card grid
assets/css/style.css                entire shared design system (CSS custom properties)
assets/js/common.js                 shared helpers (theme toggle)
tools/<tool-name>/                  one folder per tool, self-contained:
  index.html                        tool page
  app.js                            UI wiring (ES module)
  decrypt-worker.js                 optional Web Worker for heavy processing
```

- PDF decryption uses qpdf compiled to WASM (`@neslinesli93/qpdf-wasm@0.3.0`) loaded from jsDelivr inside a Web Worker so the main thread never blocks.
- The version pin appears in TWO places in `decrypt-worker.js`: the `importScripts` URL and the `locateFile` callback. Update both together.
- The worker is created lazily, so home page visitors never download the ~2 MB WASM binary.
- Theme system: `<html data-theme>` attribute set by an inline snippet in each page's `<head>` (prevents flash), toggled via button, persisted in `localStorage.theme`. Auto dark/light respects `prefers-color-scheme` when no stored preference exists.

## Conventions

- Mobile-first CSS. Fluid sizing with `clamp()`. Breakpoints at 640px and 1024px only.
- Touch targets minimum 44px. Inputs use 16px font-size (prevents iOS zoom-on-focus). Use `dvh`, not `vh`.
- Hover effects must be wrapped in `@media (hover: hover)`.
- All colors/spacing go through the CSS custom properties at the top of `style.css`. Both themes must be updated together.
- No code comments except deliberate simplification markers.

## Gotchas learned the hard way

- A CSS rule setting `display: flex` beats the UA's `[hidden]` attribute. That is why `[hidden] { display: none !important }` exists globally — do not remove it.
- qpdf/Emscripten exit code 2 conflates "wrong password" with "corrupt file". The `%PDF-` magic-byte check in `app.js` (first 1024 bytes) filters most junk upstream. Keep it.
- Emscripten MEMFS persists across `callMain()` invocations. Always try/catch-`unlink` both `/in.pdf` and `/out.pdf` before writing a new job.
- Owner-password-only PDFs (permission restrictions) unlock with NO password — probe without one first, show the password field only after a failed empty attempt.
- `callMain` returns exit codes: 0 = success, 2 = invalid password or unreadable file.

## Adding a new tool

1. Create `tools/<tool-name>/index.html` copying the existing tool page structure (header, footer, theme snippet, panel layout).
2. Add `app.js`; add a worker file only if processing can block the main thread.
3. Reuse `assets/css/style.css` classes — add new component styles there, not inline.
4. Add a card to the grid in the root `index.html`. Unbuilt tools get class `card-soon` plus badge `badge-soon`.

## Boundaries

Never:
- Commit secrets, keys, or tokens.
- Send user files or passwords anywhere — all processing MUST stay client-side. This privacy promise is stated in the UI and is the product.
- Remove or bypass the `[hidden]` global rule or the magic-byte check above.

Ask first:
- Adding any dependency, bundler, framework, or build step.
- Bumping the qpdf-wasm version pin — requires rerunning the full decrypt-flow test matrix afterward (user-pw correct/wrong, owner-only, unencrypted, corrupt).
