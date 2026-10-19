# Quick Utility Tools

Small tools that run entirely in your browser. No account, no install, no uploads.

**Live:** [just-sampath.github.io/quick-utility-tools](https://just-sampath.github.io/quick-utility-tools/)

## Tools

### PDF Password Remover

Removes the password from a PDF you have the password for. Text stays selectable and images stay as they were, because the file is decrypted rather than re-rendered.

- Runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly ([`@neslinesli93/qpdf-wasm`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)) inside a Web Worker, so the page stays responsive on large files.
- Your file and password never leave your device. The only download is the qpdf engine itself (about 2 MB from jsDelivr), fetched the first time you unlock a file.
- If a PDF needs a password to open, you enter it. PDFs that only restrict printing or copying unlock without one.

Coming later: an image size reducer and a PDF size reducer.

## Run locally

There's no build step and no dependencies: plain HTML, CSS and ES modules.

```bash
python -m http.server
```

Then open http://localhost:8000. Opening the files directly (`file://`) won't work, because the Web Worker, ES modules and the WASM fetch all need a server.

## Layout

```text
index.html                     home page with the tool cards
assets/css/style.css           shared styles and theme tokens
assets/js/common.js            theme toggle
tools/pdf-password-remover/    tool page, UI script and decrypt worker
```

Each tool lives in its own folder under `tools/` and gets a card in `index.html`.
