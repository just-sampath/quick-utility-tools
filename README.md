# Quick Utility Tools

Small tools that run entirely in your browser. No account, no install, no uploads.

**Live:** [just-sampath.github.io/quick-utility-tools](https://just-sampath.github.io/quick-utility-tools/)

## PDF tools

The PDF tools run [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly. The current build can't repair damaged files the way desktop qpdf does, so a PDF with a broken cross-reference table or a cut-off ending is reported as damaged. Saving a new copy from another PDF app usually fixes it.

### PDF Password Remover

Removes the password from a PDF you have the password for. Text stays selectable and images stay as they were, because the file is decrypted rather than re-rendered.

- Runs [qpdf](https://github.com/qpdf/qpdf) compiled to WebAssembly ([`@neslinesli93/qpdf-wasm`](https://www.npmjs.com/package/@neslinesli93/qpdf-wasm)) inside a Web Worker, so the page stays responsive on large files.
- Your file and password never leave your device. The only download is the qpdf engine itself (about 2 MB from jsDelivr), fetched the first time you unlock a file.
- If a PDF needs a password to open, you enter it. PDFs that only restrict printing or copying unlock without one.

### PDF Password Adder

Locks a PDF with a password using AES-256 encryption. The content is not re-rendered, so text stays selectable and images stay as they were.

- Runs qpdf in a Web Worker, like the password remover. Your file and passwords never leave your device.
- Asks for the password twice, with an optional separate owner password (defaults to the same password). Passwords can contain any characters, including a leading dash.
- **Permissions** can block printing, copying text and images, or editing. Blocking anything needs an owner password that differs from the open password, because opening the PDF with the owner password lifts the limits. Most PDF apps respect these limits, but they can't stop someone determined to get around them.
- PDFs that are already password protected are rejected with a pointer to the remover.

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

### PDF Page Organizer

Reorders, rotates and deletes the pages of a PDF. Pages are copied as they are, so text stays selectable and images stay original.

- Each page has buttons to move it earlier or later, rotate it left or right, and delete or restore it. On a computer you can also drag pages into place. **Reset changes** undoes everything before you save.
- Previews show the largest JPEG image embedded in each page, which covers scans and photos. Pages without one, such as text-only pages, show a numbered blank sheet, because drawing text and vector pages would need a PDF renderer such as pdf.js.
- A PDF that needs a password to open asks for it first.
- Uses the same qpdf engine as the other PDF tools (`--pages` and `--rotate`).

### PDF Metadata Editor

Shows and edits the title, author, subject, keywords, creator, producer and created/modified dates of a PDF, or strips all metadata.

- **Save PDF** writes only the fields you changed into the Info dictionary. Clearing a field removes it. Non-ASCII text is stored as a proper PDF text string.
- **Strip all metadata** removes the Info dictionary and the XMP metadata stream from the catalog. Saving alone leaves any XMP stream in place, and the page says when one is present.
- Uses the same qpdf engine as the other PDF tools. Password-protected PDFs ask for the password and keep it on the saved copy.

### Images to PDF

Combines images into one PDF, one image per page. No PDF library is loaded: the file is written by a small PDF writer in this repo.

- Takes JPG, PNG, WebP and HEIC, plus GIF, BMP and AVIF where the browser can open them. HEIC opens natively where the browser supports it (Safari) and through libheif elsewhere. The arrows set the page order.
- **Page size** is each image's own size, A4 or US Letter. A4 and Letter pages turn sideways for wide images, and the image is scaled to fit. **Margin** is none, small (¼ inch) or large (½ inch).
- Baseline and progressive RGB or grayscale JPGs are embedded byte for byte, so their quality doesn't change. Other images, including JPGs that need rotating from their EXIF orientation, are drawn on a canvas and stored losslessly (Flate, with a soft mask for transparency). The PDF can then be larger than the originals, and the result says so.
- Images larger than about 16.7 megapixels are scaled down and flagged.

## Image tools

### Image Size Reducer

Shrinks JPG, PNG, WebP and HEIC images, plus AVIF where the browser can open it, one or many at a time. Results can be downloaded one by one or as a ZIP.

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

### Image Converter

Converts JPG, PNG, WebP, HEIC and AVIF images to JPG, PNG or WebP, one or many at a time, with a ZIP download for batches.

- The pixel size is kept. JPG and WebP have a quality setting, PNG is lossless, and transparent areas become white or black when the result is a JPG.
- HEIC opens natively where the browser supports it (Safari) and through libheif elsewhere. AVIF opens where the browser can decode it. Animated WebP and APNG files keep only their first frame, and GIF isn't accepted for the same reason.
- Images larger than about 16.7 megapixels are scaled down to the browser's canvas limit and flagged.
- Uses the same codecs as the Image Size Reducer, loaded only when needed. The size change is shown for every file, including increases, and a file converted to its own format is flagged as re-encoded.

### Image Crop, Rotate and Flip

Crops, rotates, straightens and flips one image at a time, entirely on a canvas. No codec or engine is downloaded.

- Opens JPG, PNG and WebP, plus AVIF, GIF and BMP where the browser can decode them. HEIC opens only in browsers that decode it natively (Safari).
- Drag the crop box or its handles on the picture, or type exact Left, Top, Width and Height values in pixels. Crop shape presets (square, 4:3, 3:2, 16:9 and their portrait versions) keep the ratio while you resize.
- Rotate in 90 degree steps, flip horizontally or vertically, and straighten by up to 45 degrees in either direction. The crop box resets after a rotation or straightening change.
- Save as JPG, PNG, WebP or the original format, with a quality setting for JPG and WebP. The fill color (white or black) shows in the corners of a straightened JPG, while PNG and WebP keep them transparent.
- EXIF orientation is applied on load, and saving strips photo metadata such as camera model and GPS location. Results larger than 16 megapixels, just under the browser's canvas limit, are scaled down and flagged.

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

## Checks

```bash
node tests/check.mjs
```

Needs Node 18 or later and nothing else. The script checks that every script parses, that every page's Content-Security-Policy matches its inline scripts and engine use, that each page has the elements its scripts and the shared `core/` modules look up, that CDN packages are pinned, and that the shared ZIP, image-sniffing and image-metadata code behaves. It then runs the real PDF worker files against the pinned qpdf build, which it downloads once into the system temp folder. Add `--offline` to use only that cached copy. The image codec workers need a browser canvas, so test them in a browser.

## Layout

```text
index.html                     home page with the tool cards
LICENSE                        MIT License for the code in this repository
assets/css/style.css           shared styles and theme tokens
assets/js/common.js            theme toggle, worker job runner, file and status helpers
assets/js/qpdf.js              shared qpdf-wasm loader for PDF workers
assets/js/codecs.js            on-demand image codecs (MozJPEG, WebP, oxipng, image-q, libheif), format sniffing and decode helpers
assets/js/zip.js               small ZIP writer, CRC32 and the "Download all as ZIP" button
core/pdf/                      page logic shared by the PDF tools: one-file flow, PDF checks, messages
core/image/                    page logic shared by the image tools: file list and batch, format checks, messages
tools/pdf-password-remover/    tool page, UI script and decrypt worker
tools/pdf-password-adder/      tool page, UI script and encrypt worker
tools/pdf-size-reducer/        tool page, UI script and compress worker
tools/pdf-merge-split/         tool page, UI script and merge/split worker
tools/pdf-page-organizer/      tool page, UI script and organize worker
tools/pdf-metadata-editor/     tool page, UI script and metadata worker
tools/images-to-pdf/           tool page, UI script, convert worker and small PDF writer
tools/image-size-reducer/      tool page, UI script and compress worker
tools/image-converter/         tool page, UI script and convert worker
tools/image-crop-rotate/       tool page and UI script (canvas only, no worker)
tools/image-metadata/          tool page, UI script and metadata parser (no worker)
tests/check.mjs                dependency-free checks (node tests/check.mjs)
tests/fixtures/                small JPG, PNG and WebP files carrying EXIF and GPS data
```

Each tool lives in its own folder under `tools/`, gets a card in `index.html` and a section in this README. Page logic that several tools of one type share lives in `core/pdf/` or `core/image/`.

## License

The code in this repository is released under the [MIT License](LICENSE).

## Third-party licenses

All of these are loaded unmodified from jsDelivr: qpdf (Apache-2.0), jSquash codecs (Apache-2.0), image-q (MIT) and libheif-js (LGPL-3.0).
