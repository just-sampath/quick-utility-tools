# Browser test results

Site: https://just-sampath.github.io/quick-utility-tools/
Run: 2026-11-26T15:13:48.626Z

25 of 25 tool tests passed. Layout pass: no problems across 72 page views.

| Result | Test | Time | Details |
| --- | --- | --- | --- |
| Pass | PDF merge: 5 + 3 pages | 0.8s | 8 pages out; chip reads "Merged
:
2 PDFs" |
| Pass | PDF split: every page | 0.6s | ZIP holds 5 one-page PDFs |
| Pass | PDF split: every 2 pages | 0.6s | 3 parts: 2, 2 and 1 pages |
| Pass | PDF extract: pages 2-3,5 | 0.6s | 3 pages out |
| Pass | PDF extract: bad range is rejected | 0.3s | error: "Page 9 doesn't exist. This PDF has 5 pages." |
| Pass | PDF size reducer: image-heavy PDF | 3.0s | 2575 KB to 191 KB, 3 pages kept |
| Pass | PDF page organizer: delete, rotate, move | 1.0s | summary "4 of 5 pages kept"; 4 pages, first page turned 90° |
| Pass | PDF password adder: lock with AES-256 | 0.9s | output is encrypted; perms chip: "None" |
| Pass | PDF password adder: mismatched passwords | 1.8s | blocked: "The passwords don't match." |
| Pass | PDF password remover: wrong then right password | 1.1s | wrong password: "Incorrect password. Try again."; unlocked, 5 pages |
| Pass | PDF password remover: unlocked PDF | 1.1s | message: ""; result: "Decrypted copy ready" |
| Pass | PDF metadata editor: change title | 0.8s | read title "Original Title"; saved title "New E2E Title", author kept |
| Pass | PDF metadata editor: strip all | 0.6s | title and author removed |
| Pass | Images to PDF: 5 formats on A4 | 1.0s | 5 landscape A4 pages from wide JPG, PNG, WebP, BMP and GIF |
| Pass | Images to PDF: same size as each image | 0.6s | 2 pages shaped like the images, reordered |
| Pass | Image converter: JPG and PNG to WebP | 1.4s | photo-large.webp 2400x1600; alpha.webp 600x400 |
| Pass | Image converter: WebP to JPG | 1.0s | photo.jpg 1200x800 |
| Pass | Image size reducer: 50% JPG | 1.1s | photo-large_compressed.jpg 1200x800, 852 KB to 34 KB |
| Pass | Image size reducer: PNG to WebP | 0.6s | alpha_compressed.webp webp 600x400 |
| Pass | Image crop: exact box 400x300 | 0.7s | photo_edited.png 400x300 |
| Pass | Image crop: rotate right and flip | 0.6s | photo_edited.jpg 800x1200 |
| Pass | Image crop: GIF and BMP open | 0.9s | tiny.gif saved as tiny_edited.png (png 300x200); photo.bmp saved as photo_edited.png (png 400x300) |
| Pass | Image metadata: strip, keep orientation | 0.4s | exif_clean.jpg: only the orientation tag left; exif_clean.png: only the orientation tag left; exif_clean.webp: only the orientation tag left; summary: "exif.jpg 864 B → 689 B · Removed EXIF, GPS, comments Cleaned Details Download Re" |
| Pass | Image metadata: strip, drop orientation | 0.3s | exif_clean.jpg: no EXIF left; exif_clean.png: no EXIF left; exif_clean.webp: no EXIF left; summary: "exif.jpg 864 B → 653 B · Removed EXIF, GPS, comments Cleaned Download Remove" |
| Pass | Home: filter and search | 0.2s | All 11, PDF 7, Images 4; "/" focuses search; "merge" finds 1; "password" finds its group of 4 |
