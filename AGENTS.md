# AGENTS.md

Static collection of browser-based utility tools. Everything runs client-side on the user's device — nothing is ever uploaded. Deployed as plain static files on GitHub Pages.

## Critical constraint

There is NO build step and NO package.json. This is deliberate. Vanilla HTML/CSS/JS only, ES modules, no bundler, no framework, no npm install. Third-party engines (qpdf, jSquash codecs, image-q, libheif) are loaded at runtime from jsDelivr at exact pinned versions, only when a job needs them. Do not add tooling without asking first.

## Commands

- Local preview (required — workers, ES modules, and WASM fetch all fail on `file://`):
  `python -m http.server` from this directory, then open `http://localhost:8000`
- Syntax-check an ES module JS file (no package.json means `.js` defaults to CJS checking):
  copy to a temp `.mjs` file, then `node --check tempfile.mjs`
- Test qpdf-wasm engine changes in Node before shipping UI changes:
  `npm pack @neslinesli93/qpdf-wasm`, extract, then write a small `.cjs` script that loads the dist glue via `require()`, writes PDF bytes with `q.FS.writeFile()`, runs `q.callMain([...])`, and reads results with `q.FS.readFile()`. Test with real encrypted PDFs made by pikepdf (user password, wrong password, owner-only, unencrypted).
- Browser tests: the page CSP blocks `fetch()` of local test files, so serve a copy with the CSP meta stripped for functional tests, and generate inputs in-page (canvas, hand-built PDF) for CSP-mode tests. To check browser behaviour where the page policy also applies to workers, serve `*-worker.js` with the page's policy as a `Content-Security-Policy` header.
- PowerShell gotcha: inline `node -e "..."` breaks on quoting. Always write test scripts to files instead.

## Architecture

```
index.html                          home page: hero + tool card grid
assets/css/style.css                entire shared design system (CSS custom properties)
assets/js/common.js                 shared ES module helpers (theme, job runner, status messages, dropzone, names)
assets/js/qpdf.js                   shared qpdf-wasm loader for workers (classic script, loaded via importScripts)
assets/js/codecs.js                 on-demand image codecs (ES module, imported inside workers)
assets/js/zip.js                    store-only ZIP writer for "Download all"
tools/<tool-name>/                  one folder per tool, self-contained:
  index.html                        tool page
  app.js                            UI wiring (ES module)
  *-worker.js                       optional Web Worker for heavy processing
```

- Workers are driven through `createJobRunner(url, type)` from `common.js`. `run(payload, transfer, onProgress)` returns a Promise of the worker's reply. Replies must echo `id`; a message with a `progress` field calls `onProgress` instead of settling. `cancel()` abandons in-flight jobs: their promises never settle, so a reply for a removed file can't land on the next one. A worker crash rejects pending jobs and the next `run` starts a fresh worker.
- PDF processing uses qpdf compiled to WASM (`@neslinesli93/qpdf-wasm@0.3.0`, qpdf 12.2.0). A worker does `importScripts("../../assets/js/qpdf.js")`, then either `runQpdf(bytes, options)` for a single call, or `loadQpdf()` + `qpdfExec(q, args)` for multi-step jobs. All job files live in `/job`; call `qpdfClearJob(q)` at the start and end of every job.
- Image codecs live in `codecs.js`: `encodeJpeg` (MozJPEG), `encodeWebp`, `encodePng` (image-q palette + own dither + oxipng), `decodeHeic` (libheif). Each loads on first use and retries the load after a failure.
- Version pins live in exactly two files: `QPDF_BASE` in `assets/js/qpdf.js` and the constants at the top of `assets/js/codecs.js`.
- Engines load lazily inside workers, so the home page and an idle tool page download nothing from the CDN.
- Theme system: `<html data-theme>` attribute set by an inline snippet in each page's `<head>` (prevents flash), toggled via button, persisted in `localStorage.theme`. Auto dark/light respects `prefers-color-scheme` when no stored preference exists.

## Target devices

Layouts are tuned and checked at these CSS viewports (Chrome, browser UI subtracted):

| Device | Portrait | Landscape |
|---|---|---|
| Samsung Galaxy S26 Ultra (6.9", 3120×1440) | 412×~780 (384 wide at larger screen zoom) | ~891×340 |
| Samsung Galaxy Tab S9 (11", 2560×1600) | 753–800 wide × ~1100 | 1205–1280 × ~660 |
| MSI Bravo 15 B5DD (15.6", 1920×1080) | — | 1536×~738 at Windows' default 125% scaling, 1920×~950 at 100% |

After layout changes, check every size above for horizontal overflow, orphaned grid items, tap targets under 44px, and whether the primary action is reachable.

## Conventions

- Mobile-first CSS. Fluid sizing with `clamp()`. Width breakpoints at 640px and 1024px only. One height query, `(max-height: 500px)`, handles phone landscape (the header stops being sticky). Components inside `.options` adapt to their own width with a container query at 480px, because the same panel is full-width on phones and tablets but a 360px sidebar on laptops.
- At 1024px and up, pages with `<main class="... tool-wide">` and a visible `.options` panel switch to two columns: content on the left, a sticky settings sidebar on the right whose action buttons stay pinned at its bottom.
- Touch targets minimum 44px. Inputs use 16px font-size (prevents iOS zoom-on-focus). Never use `vh`: use `svh` for spacing (stable while the mobile URL bar collapses) and `dvh` for full-height layout.
- Pages use `viewport-fit=cover`, so the container, header and footer pad with `env(safe-area-inset-*)` to stay clear of the camera cutout and the Android gesture bar.
- Every page carries `<meta name="color-scheme" content="light dark">` (stops Samsung Internet's forced dark mode from repainting the site) and two `theme-color` metas; `initTheme` keeps them matched to the chosen theme.
- Hover effects must be wrapped in `@media (hover: hover)`.
- Show/hide elements with the `hidden` attribute, never with `.visible`-style classes. Components set their real `display` and rely on the global `[hidden]` rule.
- All colors/spacing go through the CSS custom properties at the top of `style.css`. Both themes must be updated together.
- Never hand back a file bigger than the input without saying so: tools either return the original ("Already optimized") or show the size increase.
- No code comments except deliberate simplification markers.

## Content Security Policy

Every page has a `<meta http-equiv="Content-Security-Policy">` right after the viewport meta. It starts from `default-src 'none'`, so the page itself cannot send data anywhere. That is what backs the privacy promise in the browser.

- Inline scripts are allowed by `sha256-` hash. Changing a single character (even whitespace) of an inline `<script>` breaks it; recompute the hash: sha256 over the exact text between `<script>` and `</script>` with LF line endings, base64-encoded. The theme snippet hash is `sha256-0ZxDdlRWLE0snWOzNyQGBvzFX1j3aKuKK8buDOlluUk=` while the snippet is copied unchanged.
- Pages whose worker loads an engine also allow `https://cdn.jsdelivr.net` in `script-src`/`connect-src`, plus `'wasm-unsafe-eval'` and `worker-src 'self'`. Browsers that apply the page policy to the worker need these; pages without a worker must not list them.
- A meta CSP does not cover a same-origin worker in browsers that follow CSP3 (the worker would need its own response header, which GitHub Pages can't set). Keep worker code to engine calls and posting results back.
- No `style="..."` attributes or inline `<style>`: `style-src` is `'self'` only.

## Gotchas learned the hard way

- A CSS rule setting `display: flex` beats the UA's `[hidden]` attribute. That is why `[hidden] { display: none !important }` exists globally — do not remove it.
- qpdf/Emscripten exit code 2 conflates "wrong password" with "corrupt file". The `%PDF-` magic-byte check (`looksLikePdf`, first 1024 bytes) filters most junk upstream. Keep it.
- `callMain` exit codes: 0 = success, 2 = invalid password or unreadable file, 3 = success with warnings. The password remover accepts only 0; the size reducer accepts 0 and 3 because real-world PDFs often produce warnings.
- Emscripten MEMFS persists across `callMain()` invocations. That is why jobs use `/job` and `qpdfClearJob`.
- Owner-password-only PDFs (permission restrictions) open with NO password — probe without one first, show the password field only after a failed empty attempt. qpdf keeps the input's encryption on output unless `--decrypt` is passed.
- qpdf `--optimize-images --jpeg-quality=N` re-encodes existing JPEGs too (when smaller), but never downsamples. Downsampling goes through JSON v2: `--json=2 --json-key=qpdf` (the `objects` key is v1-only), export chosen streams raw with `--json-object=N,G --json-stream-data=file --json-stream-prefix=/job/s --decode-level=none` (files land at `/job/s-N`), then write them back with `--update-from-json`.
- PDF viewers ignore EXIF orientation in embedded JPEGs, so decode them with `imageOrientation: "none"` and `colorSpaceConversion: "none"`, and skip any image whose decoded size doesn't match `/Width`/`/Height`. Only DeviceRGB, DeviceGray and ICCBased N=1/3 DCT images are resized; CMYK, Indexed, masks, `/Decode` and `/DecodeParms` are left to qpdf.
- `@jsquash/webp` and `@jsquash/oxipng` entry files import the bare specifier `wasm-feature-detect`, which can't resolve from a CDN inside a worker (no import maps). `codecs.js` imports their codec files directly. Use oxipng's single-thread `codec/pkg` build: threads need COOP/COEP headers, which GitHub Pages can't send.
- image-q's wuquant on a full image is far too slow (12 s for 3 MP). Build the palette from a strided sample of at most 262,144 pixels and map pixels with the cached Floyd–Steinberg in `codecs.js`.
- The PDF size reducer worker is a classic worker (it needs `importScripts` for qpdf) and loads `codecs.js` with dynamic `import()`.
- iOS caps canvas area at about 16.7 MP; the image worker scales down anything larger and tells the user.

## Adding a new tool

1. Create `tools/<tool-name>/index.html` copying the existing tool page structure (CSP meta, header, footer, theme snippet, panel layout). Trim the CSP if the tool has no engine-loading worker.
2. Add `app.js`; add a worker file only if processing can block the main thread, and drive it with `createJobRunner`.
3. Reuse `assets/css/style.css` classes — add new component styles there, not inline.
4. Add a card to the grid in the root `index.html`. Unbuilt tools get class `card-soon` plus badge `badge-soon`.

## Boundaries

Never:
- Commit secrets, keys, or tokens.
- Send user files or passwords anywhere — all processing MUST stay client-side. This privacy promise is stated in the UI and is the product.
- Remove or bypass the `[hidden]` global rule or the magic-byte check above.
- Load an engine at page load, or reference a CDN package without an exact version.

Ask first:
- Adding any dependency, bundler, framework, or build step.
- Bumping any pinned engine version. qpdf needs the full test matrix rerun afterward: password remover (user-pw correct/wrong, owner-only, unencrypted, corrupt) and size reducer (scanned JPEG, Flate image, grayscale, CMYK, encrypted, owner-only, text-only, already-small). Codec bumps need the image matrix rerun (JPG with EXIF rotation, PNG with alpha, WebP, HEIC, unsupported file, already-optimized).
