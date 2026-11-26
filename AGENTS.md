# AGENTS.md

Static collection of browser-based utility tools. Everything runs client-side on the user's device — nothing is ever uploaded. Deployed as plain static files on GitHub Pages.

## Critical constraint

There is NO build step and NO package.json. This is deliberate. Vanilla HTML/CSS/JS only, ES modules, no bundler, no framework, no npm install. Third-party engines (qpdf, jSquash codecs, image-q, libheif) are loaded at runtime from jsDelivr at exact pinned versions, only when a job needs them. The one approved dev script is `tests/check.mjs`, which runs on plain Node with no dependencies. Do not add other tooling without asking first.

## Commands

- Checks (run before every PR, needs Node 18+): `node tests/check.mjs`. It syntax-checks every script, checks each page's CSP hashes and engine allowances, element IDs, CDN pins, the ZIP writer, image sniffing and `metadata.js`, then loads the real PDF worker files in a Node `vm` against the pinned qpdf build (downloaded once to the system temp folder; `--offline` uses only the cache). Add cases there when a PDF worker changes.
- Local preview (required — workers, ES modules, and WASM fetch all fail on `file://`):
  `python -m http.server` from this directory, then open `http://localhost:8000`
- Syntax-check a single ES module JS file (no package.json means `.js` defaults to CJS checking):
  copy to a temp `.mjs` file, then `node --check tempfile.mjs`
- Try qpdf commands by hand: `npm pack @neslinesli93/qpdf-wasm@<version>`, extract, then write a small `.cjs` script that loads the dist glue via `require()`, writes PDF bytes with `q.FS.writeFile()`, runs `q.callMain([...])`, and reads results with `q.FS.readFile()`. Real encrypted PDFs made by pikepdf are good extra inputs (user password, wrong password, owner-only, unencrypted).
- Browser tests: the page CSP blocks `fetch()` of local test files, so serve a copy with the CSP meta stripped for functional tests, and generate inputs in-page (canvas, hand-built PDF) for CSP-mode tests. To check browser behaviour where the page policy also applies to workers, serve `*-worker.js` with the page's policy as a `Content-Security-Policy` header.
- PowerShell gotcha: inline `node -e "..."` breaks on quoting. Always write test scripts to files instead.

## Architecture

```
index.html                          home page: hero + tool card grid
assets/css/style.css                entire shared design system (CSS custom properties)
assets/js/common.js                 shared ES module helpers (theme, job runner, status messages, dropzone, names)
assets/js/qpdf.js                   shared qpdf-wasm loader for workers (classic script, loaded via importScripts)
assets/js/codecs.js                 on-demand image codecs plus shared image helpers (ES module, used by workers and pages)
assets/js/zip.js                    store-only ZIP writer, crc32, and bindZipButton for "Download all as ZIP"
core/pdf/single-file.js             page logic shared by the one-PDF tools (pick, password, run, result, reset)
core/pdf/files.js                   isPdfFile, looksLikePdf
core/pdf/messages.js                engine, password and damaged-file messages shared by every PDF page
core/image/file-list.js             page logic shared by the image list tools (list, batch, summary, ZIP)
core/image/files.js                 sniffImages: accept JPG/PNG/WebP/HEIC/AVIF, skip the rest with one message
core/image/messages.js              decode errors and wording shared by the image pages
tests/check.mjs                     dependency-free checks (see Commands)
tests/fixtures/                     tiny JPG/PNG/WebP files with EXIF, GPS and orientation 6
tools/<tool-name>/                  one folder per tool, self-contained:
  index.html                        tool page
  app.js                            UI wiring (ES module)
  *-worker.js                       optional Web Worker for heavy processing
  *.js                              optional tool-local modules (images-to-pdf/pdf-writer.js, image-metadata/metadata.js)
```

- Workers are driven through `createJobRunner(url, type)` from `common.js`. `run(payload, transfer, onProgress)` returns a Promise of the worker's reply. Replies must echo `id`; a message with a `progress` field calls `onProgress` instead of settling. `cancel()` abandons in-flight jobs: their promises never settle, so a reply for a removed file can't land on the next one. A worker crash rejects pending jobs and the next `run` starts a fresh worker.
- PDF processing uses qpdf compiled to WASM (`@neslinesli93/qpdf-wasm@0.3.0`, qpdf 12.2.0). A worker does `importScripts("../../assets/js/qpdf.js")`, then either `runQpdf(bytes, options)` for a single call, or `loadQpdf()` + `qpdfExec(q, args)` for multi-step jobs. All job files live in `/job`; call `qpdfClearJob(q)` at the start and end of every job. Pages send the picked `File` (`{ file }`) rather than its bytes, and workers read it with `await qpdfInput(e.data)`, which also accepts `{ bytes }`.
- One qpdf instance stops working after a couple of hundred `callMain` calls (about 200 to 390 depending on the operation; every later call throws). `loadQpdf()` therefore starts a fresh instance after `QPDF_CALL_LIMIT` (100) calls or after any call that threw, so always call `loadQpdf()` at the start of a job and never keep `q` between jobs. A job that runs many calls checks `qpdfWorn()` and reloads mid-job, as `merge-split-worker.js` does. `callMain` also changes the array it is given, so pass a new array each call. Split by every page or every N pages runs as one `--split-pages` call.
- What each tool runs on. qpdf in a classic worker (`importScripts`): `pdf-password-remover`, `pdf-password-adder`, `pdf-size-reducer`, `pdf-merge-split`, `pdf-page-organizer`, `pdf-metadata-editor`. `codecs.js` in a module worker: `image-size-reducer`, `image-converter`, `images-to-pdf` (only the shared decode helpers, which load libheif for HEIC). No worker and no engine: `image-crop-rotate` (canvas on the main thread) and `image-metadata` (byte-level parser in `metadata.js`).
- Image codecs live in `codecs.js`: `encodeJpeg` (MozJPEG), `encodeWebp`, `encodePng` (image-q palette + own dither + oxipng), `decodeHeic` (libheif). Each loads on first use and retries the load after a failure. `loadQpdf()` also forgets a failed load, so the next job tries again.
- Shared image helpers also live in `codecs.js` and load nothing from the CDN until a codec is called: `sniffFile`/`sniffImage` (format, animation and stored DPI from the first bytes), `decodeImage` (browser decode, libheif fallback for HEIC, `JobError` codes `decode`/`avif`/`heic`), `capSize` and `MAX_PIXELS`. Pages import them for sniffing, workers for decoding. Reuse them instead of copying.
- "Download all as ZIP" goes through `bindZipButton(button, zipName, getFiles, onError)` from `zip.js`. It de-duplicates names, builds the ZIP on first click, and returns `reset()`, which a page calls whenever its results change. `crc32` is exported from `zip.js` too. `buildZip(files)` takes `{ name, blob }` or `{ name, bytes }`, works out CRCs in 8 MB steps so the page stays responsive, and keeps the original Blobs as parts instead of copying them.
- `core/<type>/` holds page logic that several tools of one type share; `assets/js/` keeps the cross-cutting helpers and the engine loaders. A tool's `app.js` keeps only what is specific to it. When two tools of a type need the same page logic, put it in `core/<type>/` instead of copying it.
  - `createPdfFileTool({ worker, password, onFile, onUnlock, onReset, onBusy })` from `core/pdf/single-file.js` runs `pdf-password-remover`, `pdf-password-adder`, `pdf-size-reducer`, `pdf-page-organizer` and `pdf-metadata-editor`. It owns the dropzone, file row, PDF checks, worker, unlock form, result block and reset. `run(payload, text)` sends `{ file, password, ...payload }` (payload keys win) and returns the reply, or `null` after a crash; `fail(reply, damagedText)` shows the standard engine, password or damaged message; `showResult(bytes, suffix)` fills the download link and Original/new sizes. Pass `password: { form, input, button }` when the tool unlocks protected PDFs; the tool then keeps the password for later jobs and forgets it after a wrong one.
  - `createFileList({ action, label, zipName, prepare, idleText, worker, ... })` from `core/image/file-list.js` runs `image-converter`, `image-size-reducer` and `image-metadata`. It owns the item list, Remove buttons, busy state, batch run (`runWorkers` for module workers, `runEach` for in-page work), summary sizes and ZIP button. Hooks: `canRun`, `isError`, `setup`, `summarize`, `onChange` (after every list change), `onClear`.
  - Both read fixed element IDs: `dropzone`, `fileInput`, `msg`, `clearBtn`, `result`, `statBefore`, `statAfter`, plus `fileRow`, `fileName`, `fileSize`, `downloadBtn`, `anotherBtn` for PDF pages, and `fileList`, `options`, `addBtn`, `zipBtn`, `itemTemplate` for image pages. An image item template needs `.file-meta`, `.file-name`, `.file-size`, `.saving`, an `<a>` and a `[data-remove]` button; `.file-flag` is optional. `tests/check.mjs` follows each page's imports into `core/` and fails if an ID or template part is missing.
  - `pdf-merge-split`, `images-to-pdf` and `image-crop-rotate` have different page shapes, so they keep their own page logic and use only `core/pdf/files.js`, `core/pdf/messages.js`, `core/image/messages.js` and `moveItem` from `common.js`.
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
- Download names are the original name plus an underscore suffix: `report_decrypted.pdf`, `photo_compressed.jpg`, `photo_edited.png`, `photo_clean.jpg`.
- No code comments except deliberate simplification markers.

## Content Security Policy

Every page has a `<meta http-equiv="Content-Security-Policy">` right after the viewport meta. It starts from `default-src 'none'`, so the page itself cannot send data anywhere. That is what backs the privacy promise in the browser.

- Inline scripts are allowed by `sha256-` hash. Changing a single character (even whitespace) of an inline `<script>` breaks it; recompute the hash: sha256 over the exact text between `<script>` and `</script>` with LF line endings, base64-encoded. The theme snippet hash is `sha256-0ZxDdlRWLE0snWOzNyQGBvzFX1j3aKuKK8buDOlluUk=` while the snippet is copied unchanged.
- Pages whose worker loads an engine also allow `https://cdn.jsdelivr.net` in `script-src`/`connect-src`, plus `'wasm-unsafe-eval'` and `worker-src 'self'`. Browsers that apply the page policy to the worker need these; pages without one (`image-crop-rotate`, `image-metadata`) must not list them.
- A meta CSP does not cover a same-origin worker in browsers that follow CSP3 (the worker would need its own response header, which GitHub Pages can't set). Keep worker code to engine calls and posting results back.
- No `style="..."` attributes or inline `<style>`: `style-src` is `'self'` only.

## Gotchas learned the hard way

- A CSS rule setting `display: flex` beats the UA's `[hidden]` attribute. That is why `[hidden] { display: none !important }` exists globally — do not remove it.
- qpdf/Emscripten exit code 2 conflates "wrong password" with "corrupt file". The wasm glue ignores `printErr` and writes errors through `console.error`, so `qpdf.js` captures that before loading the glue and `qpdfPasswordProblem()` checks the last call's stderr for "password". The `%PDF-` magic-byte check (`looksLikePdf` in `core/pdf/files.js`, first 1024 bytes) still filters junk upstream. Keep both.
- `callMain` exit codes: 0 = success, 2 = invalid password or unreadable file, 3 = success with warnings. The password remover and password adder accept only 0. The size reducer, merge/split, page organizer and metadata editor accept 0 and 3 because real-world PDFs often produce warnings.
- Emscripten MEMFS persists across `callMain()` invocations. That is why jobs use `/job` and `qpdfClearJob`.
- Owner-password-only PDFs (permission restrictions) open with NO password — probe without one first, show the password field only after a failed empty attempt. qpdf keeps the input's encryption on output unless `--decrypt` is passed.
- Never pass a password as a bare argument. qpdf's old `--encrypt user owner 256 --` form reads a password starting with `-` as an option and fails with exit code 2. Use `--password=`, `--user-password=`, `--owner-password=` and `--bits=256`.
- The qpdf-wasm 0.3.x build can't repair damaged files. Its build script compiles libqpdf without exception catching, so the `catch` blocks qpdf repairs files in are compiled out: truncated files, bad `startxref` offsets and wrong stream lengths all fail with exit code 2, while desktop qpdf repairs them with exit code 3. Upstream PR neslinesli93/qpdf-wasm#11 fixes the build. The same bug makes `--requires-password` exit 2 with "invalid password" on stderr for a file that needs a password, instead of exit 0. The password adder therefore treats exit 0, exit 3 or a password error as "already encrypted", so it keeps working after a fixed build lands.
- Permission restrictions only hold with an owner password that differs from the user password: opening with the owner password grants everything. The password adder refuses restrictions without a distinct owner password and maps them to `--print=none`, `--extract=n` and `--modify=none`.
- qpdf `--optimize-images --jpeg-quality=N` re-encodes existing JPEGs too (when smaller), but never downsamples. Downsampling goes through JSON v2: `--json=2 --json-key=qpdf` (the `objects` key is v1-only), export chosen streams raw with `--json-object=N,G --json-stream-data=file --json-stream-prefix=/job/s --decode-level=none` (files land at `/job/s-N`), then write them back with `--update-from-json`.
- PDF viewers ignore EXIF orientation in embedded JPEGs, so decode them with `imageOrientation: "none"` and `colorSpaceConversion: "none"`, and skip any image whose decoded size doesn't match `/Width`/`/Height`. Only DeviceRGB, DeviceGray and ICCBased N=1/3 DCT images are resized; CMYK, Indexed, masks, `/Decode` and `/DecodeParms` are left to qpdf.
- `@jsquash/webp` and `@jsquash/oxipng` entry files import the bare specifier `wasm-feature-detect`, which can't resolve from a CDN inside a worker (no import maps). `codecs.js` imports their codec files directly. Use oxipng's single-thread `codec/pkg` build: threads need COOP/COEP headers, which GitHub Pages can't send.
- image-q's wuquant on a full image is far too slow (12 s for 3 MP). Build the palette from a strided sample of at most 262,144 pixels and map pixels with the cached Floyd–Steinberg in `codecs.js`.
- The PDF size reducer worker is a classic worker (it needs `importScripts` for qpdf) and loads `codecs.js` with dynamic `import()`.
- iOS caps canvas area at about 16.7 MP. The image tools scale down anything larger and tell the user: the size reducer, converter and images-to-PDF workers cap at 16,777,216 pixels (`MAX_PIXELS`/`capSize` in `codecs.js`) and say "about 16.7 megapixels"; `image-crop-rotate` caps at 16,000,000 on the main thread and says "16 megapixels". Keep each message matched to its constant.
- There is no PDF renderer: pdf.js would be a new dependency, so ask first. The page organizer previews a page from its largest embedded RGB or grayscale DCT image and shows a numbered blank otherwise.
- Images to PDF writes its own PDF (`pdf-writer.js`, Flate through `CompressionStream`). Baseline and progressive RGB or grayscale JPEGs with EXIF orientation 1 are embedded unchanged; everything else is drawn on a canvas and stored as Flate RGB plus a soft mask for alpha.

## Adding a new tool

1. Create `tools/<tool-name>/index.html` copying the existing tool page structure (CSP meta, header, footer, theme snippet, panel layout). Trim the CSP if the tool has no engine-loading worker.
2. Add `app.js`; add a worker file only if processing can block the main thread, and drive it with `createJobRunner`. A tool that takes one PDF builds on `createPdfFileTool`, and an image tool with a file list builds on `createFileList`; keep the standard element IDs so they work unchanged.
3. Reuse `assets/css/style.css` classes — add new component styles there, not inline.
4. Add a card to the grid in the root `index.html`, in the same order as the README: PDF tools first, then image tools. Unbuilt tools get class `card-soon` plus badge `badge-soon`. `<span class="badge badge-new">New</span>` can mark a just-launched tool; take it off once it is no longer new.
5. Add a section to `README.md` under PDF tools or Image tools, and a line to its Layout block. If the tool uses qpdf or a codec, add its cases to the bump matrix under Boundaries. If it has a qpdf worker, add its cases to `tests/check.mjs`.

## Boundaries

Never:
- Commit secrets, keys, or tokens.
- Send user files or passwords anywhere — all processing MUST stay client-side. This privacy promise is stated in the UI and is the product.
- Remove or bypass the `[hidden]` global rule or the magic-byte check above.
- Load an engine at page load, or reference a CDN package without an exact version.

Ask first:
- Adding any dependency, bundler, framework, or build step.
- Bumping any pinned engine version. qpdf needs `node tests/check.mjs` plus the full test matrix rerun afterward: password remover (user-pw correct/wrong, owner-only, unencrypted, corrupt), size reducer (scanned JPEG, Flate image, grayscale, CMYK, encrypted, owner-only, text-only, already-small), password adder (unencrypted, already encrypted, separate owner password, password starting with `-`, each permission restriction), merge/split/extract (merge, split per page, every N pages and by ranges, extract, password-protected input), page organizer (reorder, rotate, delete, JPEG thumbnails, password-protected) and metadata editor (edit, non-ASCII text, clear a field, strip with XMP present, password-protected). Codec bumps need the image matrix rerun (JPG with EXIF rotation, PNG with alpha, WebP, HEIC, unsupported file, already-optimized) in the image size reducer and image converter, plus HEIC in images to PDF.
