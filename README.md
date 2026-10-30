# Quick Utility Tools

Small tools that run entirely in your browser. No account, no install, no uploads.

**Live:** [just-sampath.github.io/quick-utility-tools](https://just-sampath.github.io/quick-utility-tools/)

## Tools

### PDF Password Remover

Removes the password from a PDF you have the password for. Text stays selectable and images stay as they were, because the file is decrypted rather than re-rendered.

- Runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly ([`@neslinesli93/qpdf-wasm`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)) inside a Web Worker, so the page stays responsive on large files.
- Your file and password never leave your device. The only download is the qpdf engine itself (about 2 MB from jsDelivr), fetched the first time you unlock a file.
- If a PDF needs a password to open, you enter it. PDFs that only restrict printing or copying unlock without one.

### Image Size Reducer

Shrinks JPG, PNG, WebP and HEIC images, one or many at a time, with optional resizing and format conversion. Results can be downloaded one by one or as a ZIP.

- JPG uses MozJPEG, WebP uses libwebp, and PNG is color-reduced with [image-q](https://github.com/ibezkrovnyi/image-quantization) and then optimized with oxipng. The codecs come from [jSquash](https://github.com/jamsinclair/jSquash).
- HEIC files open natively where the browser supports it (Safari). Elsewhere [libheif-js](https://github.com/catdad-experiments/libheif-js) decodes them.
- Each codec downloads only when an image needs it (MozJPEG about 250 KB, WebP 280 KB, oxipng 165 KB, image-q 100 KB, libheif 2 MB).
- Re-encoding strips photo metadata such as camera model and GPS location. If compressing would make an image bigger and you didn't ask to resize or convert it, you get the original back.

### PDF Size Reducer

Makes PDFs smaller while keeping text selectable and any password protection in place.

- **Lossless** only rewrites the file structure (object streams, recompressed Flate data).
- **Balanced** and **Smallest** also recompress images and scale down JPEG images larger than 2000 px or 1300 px. The images go out through qpdf's JSON interface, get resized in a worker with MozJPEG, and are written back with qpdf.
- Uses the same qpdf engine as the password remover, plus MozJPEG when images need resizing.

## Run locally

There's no build step and no npm install: plain HTML, CSS and ES modules. Third-party engines load from jsDelivr at pinned versions, only when a tool needs them.

```bash
python -m http.server
```

Then open http://localhost:8000. Opening the files directly (`file://`) won't work, because the Web Workers, ES modules and WASM fetches all need a server.

## Layout

```text
index.html                     home page with the tool cards
assets/css/style.css           shared styles and theme tokens
assets/js/common.js            theme toggle, worker job runner, file and status helpers
assets/js/qpdf.js              shared qpdf-wasm loader for PDF workers
assets/js/codecs.js            on-demand image codecs (MozJPEG, WebP, oxipng, image-q, libheif)
assets/js/zip.js               small ZIP writer for "Download all"
tools/pdf-password-remover/    tool page, UI script and decrypt worker
tools/image-size-reducer/      tool page, UI script and compress worker
tools/pdf-size-reducer/        tool page, UI script and compress worker
```

Each tool lives in its own folder under `tools/` and gets a card in `index.html`.

## Third-party licenses

All of these are loaded unmodified from jsDelivr: qpdf (Apache-2.0), jSquash codecs (Apache-2.0), image-q (MIT) and libheif-js (LGPL-3.0).
