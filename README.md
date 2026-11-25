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

Shrinks JPG, PNG, WebP and HEIC images, one or many at a time. Results can be downloaded one by one or as a ZIP.

- Choose the new size by percent or pixels. The padlock keeps each image's aspect ratio, and unlocking it sets an exact width and height.
- Choose the format (JPG, WebP or PNG), the quality (1 to 100) and an optional resolution in DPI. JPG and PNG files store the DPI value, WebP files can't.
- The background color (white or black) fills transparent areas when an image becomes a JPG.
- In Pixels mode with the padlock locked, every image keeps its own aspect ratio. When a batch mixes different shapes, the linked field is left on "Auto" and a note explains that the other dimension differs per image.
- PNG quality sets the palette size: 90 and above keeps every color, 75 to 89 uses 256 colors, and lower values shrink it further (down to 16). Grayscale PNGs are reduced by gray levels instead, so quality changes their size as well.
- Animated WebP and APNG files are reduced to their first frame, and the file's status line says so. GIF files are not accepted, for the same reason.
- The resolution field starts empty ("Not set"). When the original files store a resolution in a JFIF header (JPG) or pHYs chunk (PNG), a note shows it. Resolution stored only in EXIF isn't read.
- Images larger than about 16.7 megapixels are scaled down to the browser's canvas limit, and this is flagged on the file and in the result summary.

- JPG uses MozJPEG, WebP uses libwebp, and PNG is color-reduced with [image-q](https://github.com/ibezkrovnyi/image-quantization) and then optimized with oxipng. The codecs come from [jSquash](https://github.com/jamsinclair/jSquash).
- HEIC files open natively where the browser supports it (Safari). Elsewhere [libheif-js](https://github.com/catdad-experiments/libheif-js) decodes them.
- Each codec downloads only when an image needs it (MozJPEG about 250 KB, WebP 280 KB, oxipng 165 KB, image-q 100 KB, libheif 2 MB).
- Re-encoding strips photo metadata such as camera model and GPS location. If compressing would make an image bigger and you didn't ask to resize, convert or change the resolution of it, you get the original back.

### PDF Size Reducer

Makes PDFs smaller while keeping text selectable and any password protection in place.

- **Lossless** only rewrites the file structure (object streams, recompressed Flate data).
- **Balanced** (quality 75, longest side 2000 px) and **Smallest** (quality 55, 1300 px) also recompress images and scale down larger JPEG images. **Custom** unlocks the same controls: image quality (1 to 100%) and a size limit, either a percentage of the original or a longest side in pixels. Editing any value switches to Custom, and images are never enlarged. Resolution (DPI), format and background aren't offered because PDF images have no fixed DPI until placed on a page, and the output stays a PDF. The images go out through qpdf's JSON interface, get resized in a worker with MozJPEG, and are written back with qpdf.
- Uses the same qpdf engine as the password remover, plus MozJPEG when images need resizing.

### Image Metadata Viewer and Remover

Shows what hidden data JPG, PNG and WebP images carry and removes it without re-encoding, so the pixels are never touched.

- Lists EXIF (camera make and model, date taken, exposure, lens, orientation), GPS coordinates, XMP, IPTC, comments, PNG text chunks and timestamps, and color profiles.
- Removal cuts the metadata segments or chunks out of the file and copies the image data byte for byte. PNG and WebP keep only known image chunks, so unrecognised chunks (such as C2PA content credentials) are removed too, and so is any data appended after the end of the image. Files with nothing to remove come back unchanged.
- **Keep orientation** (on by default) leaves a minimal EXIF block with only the orientation tag, so rotated photos still display upright. **Remove color profile** is off by default.
- The Image Size Reducer already drops metadata as a side effect of re-encoding. This tool is the lossless option, and it lets you inspect first.

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
tools/image-metadata/          tool page, UI script and metadata parser
```

Each tool lives in its own folder under `tools/` and gets a card in `index.html`.

## Third-party licenses

All of these are loaded unmodified from jsDelivr: qpdf (Apache-2.0), jSquash codecs (Apache-2.0), image-q (MIT) and libheif-js (LGPL-3.0).
