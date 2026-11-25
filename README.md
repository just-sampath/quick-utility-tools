# Quick Utility Tools

Small tools that run entirely in your browser. No account, no install, no uploads.

**Live:** [just-sampath.github.io/quick-utility-tools](https://just-sampath.github.io/quick-utility-tools/)

## Tools

### PDF Password Remover

Removes the password from a PDF you have the password for. Text stays selectable and images stay as they were, because the file is decrypted rather than re-rendered.

- Runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly ([`@neslinesli93/qpdf-wasm`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)) inside a Web Worker, so the page stays responsive on large files.
- Your file and password never leave your device. The only download is the qpdf engine itself (about 2 MB from jsDelivr), fetched the first time you unlock a file.
- If a PDF needs a password to open, you enter it. PDFs that only restrict printing or copying unlock without one.

### PDF Password Adder

Locks a PDF with a password using AES-256 encryption. The content is not re-rendered, so text stays selectable and images stay as they were.

- Runs qpdf in a Web Worker, like the password remover. Your file and passwords never leave your device.
- Asks for the password twice, with an optional separate owner password (defaults to the same password).
- PDFs that are already password protected are rejected with a pointer to the remover.

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

### Image Crop, Rotate and Flip

Crops, rotates, straightens and flips one image at a time, entirely on a canvas. No codec or engine is downloaded.

- Drag the crop box or its handles on the picture, or type exact Left, Top, Width and Height values in pixels. Crop shape presets (square, 4:3, 3:2, 16:9 and their portrait versions) keep the ratio while you resize.
- Rotate in 90 degree steps, flip horizontally or vertically, and straighten by up to 45 degrees in either direction. The crop box resets after a rotation or straightening change.
- Save as JPG, PNG, WebP or the original format, with a quality setting for JPG and WebP. The fill color (white or black) shows in the corners of a straightened JPG, while PNG and WebP keep them transparent.
- EXIF orientation is applied on load, and saving strips photo metadata such as camera model and GPS location. Results larger than about 16.7 megapixels are scaled down and flagged.

### PDF Size Reducer

Makes PDFs smaller while keeping text selectable and any password protection in place.

- **Lossless** only rewrites the file structure (object streams, recompressed Flate data).
- **Balanced** (quality 75, longest side 2000 px) and **Smallest** (quality 55, 1300 px) also recompress images and scale down larger JPEG images. **Custom** unlocks the same controls: image quality (1 to 100%) and a size limit, either a percentage of the original or a longest side in pixels. Editing any value switches to Custom, and images are never enlarged. Resolution (DPI), format and background aren't offered because PDF images have no fixed DPI until placed on a page, and the output stays a PDF. The images go out through qpdf's JSON interface, get resized in a worker with MozJPEG, and are written back with qpdf.
- Uses the same qpdf engine as the password remover, plus MozJPEG when images need resizing.

### PDF Merge, Split and Extract

Combines PDFs, splits one into several files, or extracts pages into a new PDF. Pages are copied as they are, so text stays selectable and images stay original.

- **Merge** joins two or more PDFs in the order listed. The arrows reorder them.
- **Split** cuts one PDF into a file per page, a file per N pages, or a file per page range (for example `1-3,4-6,7-z`). Several files are delivered as one ZIP.
- **Extract** copies the pages you list (for example `1-3,5,8-z`, where `z` is the last page) into a new PDF. Ranges are checked against the page count first.
- A PDF that needs a password to open asks for it in its own row. The output is not password protected.
- Uses the same qpdf engine as the other PDF tools (`--empty --pages`), fetched from jsDelivr the first time you run a job.

### Image Converter

Converts JPG, PNG, WebP, HEIC and AVIF images to JPG, PNG or WebP, one or many at a time, with a ZIP download for batches.

- The pixel size is kept. JPG and WebP have a quality setting, PNG is lossless, and transparent areas become white or black when the result is a JPG.
- Uses the same codecs as the Image Size Reducer, loaded only when needed. The size change is shown for every file, including increases, and a file converted to its own format is flagged as re-encoded.

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
tools/pdf-password-adder/      tool page, UI script and encrypt worker
tools/image-size-reducer/      tool page, UI script and compress worker
tools/pdf-size-reducer/        tool page, UI script and compress worker
tools/pdf-merge-split/          tool page, UI script and merge/split worker
tools/pdf-page-organizer/      tool page, UI script and organize worker (reorder, rotate, delete pages)
tools/images-to-pdf/           tool page, UI script, convert worker and small PDF writer
tools/image-metadata/          tool page, UI script and metadata parser
```

Each tool lives in its own folder under `tools/` and gets a card in `index.html`.

## Third-party licenses

All of these are loaded unmodified from jsDelivr: qpdf (Apache-2.0), jSquash codecs (Apache-2.0), image-q (MIT) and libheif-js (LGPL-3.0).
