// Browser tests for every tool on the site.
// Usage: node run.mjs [baseUrl]
// Default base URL is the live GitHub Pages site. Results go to ./results.
import { chromium } from "playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { unzipSync } from "fflate";
import { imageSize } from "image-size";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || process.env.BASE_URL || "https://just-sampath.github.io/quick-utility-tools/").replace(/\/?$/, "/");
const FIX = path.join(HERE, "fixtures");
const REPO_FIX = path.join(HERE, "..", "tests", "fixtures");
const OUT = path.join(HERE, "results");
const SHOTS = path.join(OUT, "screenshots");
const GEN = path.join(OUT, "generated");
const OUTPUTS = path.join(OUT, "outputs");
const JOB_TIMEOUT = 180_000;

const TOOLS = [
  "pdf-size-reducer", "image-size-reducer", "images-to-pdf", "image-converter",
  "pdf-merge-split", "pdf-page-organizer", "image-crop-rotate",
  "pdf-password-remover", "pdf-password-adder", "pdf-metadata-editor", "image-metadata",
];

const results = [];
const PASSWORD = "Test-1234!";

// ---------- fixtures made at run time ----------
async function makeTextPdf(file, pages, title) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i} of ${pages}`, { x: 72, y: 760, size: 32, font });
    page.drawText("Selectable text for checks.", { x: 72, y: 720, size: 14, font });
  }
  if (title) {
    doc.setTitle(title);
    doc.setAuthor("Original Author");
    doc.setSubject("Original subject");
  }
  await fs.writeFile(file, await doc.save());
  return file;
}

// ---------- output checks ----------
const isPdf = (b) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const hasEncrypt = (b) => b.toString("latin1").includes("/Encrypt");

async function pdfInfo(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    pages: doc.getPageCount(),
    sizes: doc.getPages().map((p) => p.getSize()),
    rotations: doc.getPages().map((p) => p.getRotation().angle),
    title: doc.getTitle(),
    author: doc.getAuthor(),
  };
}

function imageInfo(bytes) {
  const s = imageSize(new Uint8Array(bytes));
  return { type: s.type, width: s.width, height: s.height };
}

function hasImageMetadata(bytes, type) {
  const b = Buffer.from(bytes);
  if (type === "jpg") {
    let i = 2;
    while (i + 4 < b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda) break;
      const len = b.readUInt16BE(i + 2);
      if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString("latin1").startsWith("Exif")) return true;
      i += 2 + len;
    }
    return false;
  }
  if (type === "png") {
    let i = 8;
    while (i + 8 < b.length) {
      const len = b.readUInt32BE(i);
      const kind = b.subarray(i + 4, i + 8).toString("latin1");
      if (kind === "eXIf" || kind === "tEXt" || kind === "iTXt" || kind === "zTXt") return true;
      i += 12 + len;
    }
    return false;
  }
  if (type === "webp") {
    let i = 12;
    while (i + 8 < b.length) {
      const kind = b.subarray(i, i + 4).toString("latin1");
      const len = b.readUInt32LE(i + 4);
      if (kind === "EXIF" || kind === "XMP ") return true;
      i += 8 + len + (len % 2);
    }
    return false;
  }
  throw new Error("unknown type " + type);
}

// Tag numbers in a TIFF block's first IFD.
function tiffTags(b, t) {
  const le = b.subarray(t, t + 2).toString("latin1") === "II";
  const u16 = (o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = t + u32(t + 4);
  const tags = [];
  for (let n = 0; n < u16(ifd); n++) tags.push(u16(ifd + 2 + n * 12));
  return tags;
}

// Tag numbers in a PNG's eXIf chunk, or [] when it has none.
function pngExifTags(bytes) {
  const b = Buffer.from(bytes);
  let i = 8;
  while (i + 8 < b.length) {
    const len = b.readUInt32BE(i);
    if (b.subarray(i + 4, i + 8).toString("latin1") === "eXIf") return tiffTags(b, i + 8);
    i += 12 + len;
  }
  return [];
}

// Tag numbers in a WebP's EXIF chunk, or [] when it has none.
function webpExifTags(bytes) {
  const b = Buffer.from(bytes);
  let i = 12;
  while (i + 8 < b.length) {
    const len = b.readUInt32LE(i + 4);
    if (b.subarray(i, i + 4).toString("latin1") === "EXIF") {
      const start = b.subarray(i + 8, i + 14).toString("latin1") === "Exif\0\0" ? i + 14 : i + 8;
      return tiffTags(b, start);
    }
    i += 8 + len + (len % 2);
  }
  return [];
}

// Tag numbers in a JPEG's EXIF IFD0, or [] when it has no EXIF.
function jpegExifTags(bytes) {
  const b = Buffer.from(bytes);
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) break;
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString("latin1").startsWith("Exif")) {
      return tiffTags(b, i + 10);
    }
    i += 2 + len;
  }
  return [];
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------- page helpers ----------
async function openTool(context, tool) {
  const page = await context.newPage();
  const log = { console: [], pageErrors: [], failedRequests: [] };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => log.pageErrors.push(String(e)));
  page.on("requestfailed", (r) => log.failedRequests.push(`${r.url()} (${r.failure()?.errorText})`));
  page.on("response", (r) => {
    if (r.status() >= 400) log.failedRequests.push(`${r.url()} (HTTP ${r.status()})`);
  });
  const url = tool ? `${BASE}tools/${tool}/index.html` : BASE;
  await page.goto(url, { waitUntil: "load" });
  return { page, log };
}

async function waitForResult(page, selector = "#result") {
  const result = page.locator(selector);
  const error = page.locator("#msg.msg-error");
  const winner = await Promise.race([
    result.waitFor({ state: "visible", timeout: JOB_TIMEOUT }).then(() => "result"),
    error.waitFor({ state: "visible", timeout: JOB_TIMEOUT }).then(() => "error"),
  ]);
  if (winner === "error") throw new Error("Tool showed an error: " + (await error.innerText()));
}

async function download(page, locator, saveAs) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), locator.click()]);
  const bytes = await fs.readFile(await dl.path());
  const name = saveAs || dl.suggestedFilename();
  await fs.writeFile(path.join(OUTPUTS, name), bytes);
  return { bytes, name: dl.suggestedFilename() };
}

async function msgText(page) {
  const msg = page.locator("#msg");
  return (await msg.isVisible()) ? (await msg.innerText()).trim() : "";
}

// Runs one test: opens the tool, runs fn, saves a screenshot and the console log.
async function test(name, tool, fn) {
  const started = Date.now();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const { page, log } = await openTool(context, tool);
  const entry = { name, tool, ok: false, details: [], ms: 0 };
  try {
    const details = await fn(page);
    entry.details = details || [];
    const bad = log.pageErrors.length + log.console.filter((l) => l.startsWith("error")).length;
    if (bad) throw new Error(`Page logged ${bad} error(s)`);
    entry.ok = true;
  } catch (err) {
    entry.error = err.message.split("\n")[0];
  }
  entry.ms = Date.now() - started;
  entry.log = log;
  const shot = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: path.join(SHOTS, shot), fullPage: true }).catch(() => {});
  entry.screenshot = `screenshots/${shot}`;
  await context.close();
  results.push(entry);
  console.log(`${entry.ok ? "PASS" : "FAIL"}  ${name}  (${(entry.ms / 1000).toFixed(1)}s)${entry.error ? "  " + entry.error : ""}`);
}

// ---------- run ----------
await fs.rm(OUT, { recursive: true, force: true });
for (const dir of [OUT, SHOTS, path.join(SHOTS, "layout"), GEN, OUTPUTS]) await fs.mkdir(dir, { recursive: true });

const doc5 = await makeTextPdf(path.join(GEN, "doc-5-pages.pdf"), 5, "Original Title");
const doc3 = await makeTextPdf(path.join(GEN, "doc-3-pages.pdf"), 3);
const F = (n) => path.join(FIX, n);
const R = (n) => path.join(REPO_FIX, n);
let lockedPdf = null;

const browser = await chromium.launch();
console.log(`Testing ${BASE}\n`);

await test("PDF merge: 5 + 3 pages", "pdf-merge-split", async (page) => {
  await page.setInputFiles("#fileInput", [doc5, doc3]);
  await page.locator("#fileList li").nth(1).waitFor();
  await page.click("#runBtn");
  await waitForResult(page);
  const chip = (await page.locator("#statFilesWrap").innerText()).trim();
  const { bytes } = await download(page, page.locator("#downloadBtn"), "merged.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 8, `expected 8 pages, got ${info.pages}`);
  return [`8 pages out`, `chip reads "${chip}"`];
});

await test("PDF split: every page", "pdf-merge-split", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#fileList li").first().waitFor();
  await page.locator('label:has(input[name="mode"][value="split"])').click();
  await page.selectOption("#splitSelect", "every");
  await page.click("#runBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "split-every.zip");
  const files = Object.entries(unzipSync(new Uint8Array(bytes)));
  expect(files.length === 5, `expected 5 files in ZIP, got ${files.length}`);
  for (const [name, data] of files) expect((await pdfInfo(data)).pages === 1, `${name} is not 1 page`);
  return [`ZIP holds 5 one-page PDFs`];
});

await test("PDF split: every 2 pages", "pdf-merge-split", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#fileList li").first().waitFor();
  await page.locator('label:has(input[name="mode"][value="split"])').click();
  await page.selectOption("#splitSelect", "chunks");
  await page.fill("#chunkInput", "2");
  await page.click("#runBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "split-chunks.zip");
  const counts = [];
  for (const data of Object.values(unzipSync(new Uint8Array(bytes)))) counts.push((await pdfInfo(data)).pages);
  counts.sort();
  expect(counts.join(",") === "1,2,2", `expected parts of 2,2,1 pages, got ${counts}`);
  return [`3 parts: 2, 2 and 1 pages`];
});

await test("PDF extract: pages 2-3,5", "pdf-merge-split", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#fileList li").first().waitFor();
  await page.locator('label:has(input[name="mode"][value="extract"])').click();
  await page.fill("#rangeInput", "2-3,5");
  await page.click("#runBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "extract.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 3, `expected 3 pages, got ${info.pages}`);
  return [`3 pages out`];
});

await test("PDF extract: bad range is rejected", "pdf-merge-split", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#fileList li").first().waitFor();
  await page.locator('label:has(input[name="mode"][value="extract"])').click();
  await page.fill("#rangeInput", "9-12");
  await page.click("#runBtn");
  await page.locator("#msg.msg-error").waitFor({ timeout: 15_000 });
  expect(!(await page.locator("#result").isVisible()), "result shown for a bad range");
  return [`error: "${await msgText(page)}"`];
});

await test("PDF size reducer: image-heavy PDF", "pdf-size-reducer", async (page) => {
  const input = await fs.readFile(F("image-heavy.pdf"));
  await page.setInputFiles("#fileInput", F("image-heavy.pdf"));
  await page.locator("#compressBtn").waitFor({ state: "visible" });
  await page.click("#compressBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "reduced.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 3, `expected 3 pages, got ${info.pages}`);
  expect(bytes.length < input.length, `output ${bytes.length} B is not smaller than ${input.length} B`);
  return [`${(input.length / 1024).toFixed(0)} KB to ${(bytes.length / 1024).toFixed(0)} KB, 3 pages kept`];
});

await test("PDF page organizer: delete, rotate, move", "pdf-page-organizer", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  const cards = page.locator("#grid .po-card");
  await cards.nth(4).waitFor({ timeout: JOB_TIMEOUT });
  await cards.nth(1).locator(".po-del-btn").click(); // delete page 2
  await cards.nth(0).locator(".po-rot-r").click(); // rotate page 1 right
  await cards.nth(4).locator(".po-move-prev").click(); // move page 5 before page 4
  const summary = (await page.locator("#summary").innerText()).trim();
  await page.click("#saveBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "organized.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 4, `expected 4 pages, got ${info.pages}`);
  expect(info.rotations[0] === 90, `expected page 1 rotated 90, got ${info.rotations[0]}`);
  return [`summary "${summary}"`, `4 pages, first page turned 90°`];
});

await test("PDF password adder: lock with AES-256", "pdf-password-adder", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#passwordInput").waitFor({ state: "visible" });
  await page.fill("#passwordInput", PASSWORD);
  await page.fill("#confirmInput", PASSWORD);
  await page.click("#protectBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "locked.pdf");
  expect(isPdf(bytes), "output is not a PDF");
  expect(hasEncrypt(bytes), "output has no /Encrypt dictionary");
  let refused = false;
  try {
    await PDFDocument.load(bytes);
  } catch {
    refused = true;
  }
  expect(refused, "locked PDF opened without a password");
  lockedPdf = path.join(GEN, "locked.pdf");
  await fs.writeFile(lockedPdf, bytes);
  return [`output is encrypted`, `perms chip: "${(await page.locator("#statPerms").innerText()).trim()}"`];
});

await test("PDF password adder: mismatched passwords", "pdf-password-adder", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#passwordInput").waitFor({ state: "visible" });
  await page.fill("#passwordInput", PASSWORD);
  await page.fill("#confirmInput", PASSWORD + "x");
  await page.click("#protectBtn");
  await page.waitForTimeout(1500);
  expect(!(await page.locator("#result").isVisible()), "locked a PDF with mismatched passwords");
  const text = (await msgText(page)) || (await page.evaluate(() => document.getElementById("confirmInput").validationMessage));
  return [`blocked: "${text}"`];
});

await test("PDF password remover: wrong then right password", "pdf-password-remover", async (page) => {
  expect(lockedPdf, "no locked PDF from the adder test");
  await page.setInputFiles("#fileInput", lockedPdf);
  await page.locator("#passwordInput").waitFor({ state: "visible", timeout: JOB_TIMEOUT });
  await page.fill("#passwordInput", "wrong-password");
  await page.click("#unlockBtn");
  await page.locator("#msg.msg-error").waitFor({ timeout: JOB_TIMEOUT });
  const wrongMsg = await msgText(page);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#unlockBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "unlocked.pdf");
  expect(!hasEncrypt(bytes), "output is still encrypted");
  const info = await pdfInfo(bytes);
  expect(info.pages === 5, `expected 5 pages, got ${info.pages}`);
  return [`wrong password: "${wrongMsg}"`, `unlocked, 5 pages`];
});

await test("PDF password remover: unlocked PDF", "pdf-password-remover", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.waitForFunction(() => !document.getElementById("msg").hidden || !document.getElementById("result").hidden, null, { timeout: JOB_TIMEOUT });
  await page.waitForTimeout(1000);
  const title = (await page.locator("#result").isVisible()) ? (await page.locator("#result").innerText()).trim().split("\n")[0] : "";
  return [`message: "${await msgText(page)}"`, `result: "${title}"`];
});

await test("PDF metadata editor: change title", "pdf-metadata-editor", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#metaWrap").waitFor({ state: "visible", timeout: JOB_TIMEOUT });
  const before = await page.inputValue("#fTitle");
  await page.fill("#fTitle", "New E2E Title");
  await page.click("#saveBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "metadata-saved.pdf");
  const info = await pdfInfo(bytes);
  expect(info.title === "New E2E Title", `title is "${info.title}"`);
  expect(info.author === "Original Author", `author changed to "${info.author}"`);
  return [`read title "${before}"`, `saved title "${info.title}", author kept`];
});

await test("PDF metadata editor: strip all", "pdf-metadata-editor", async (page) => {
  await page.setInputFiles("#fileInput", doc5);
  await page.locator("#metaWrap").waitFor({ state: "visible", timeout: JOB_TIMEOUT });
  await page.click("#stripBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#downloadBtn"), "metadata-stripped.pdf");
  const info = await pdfInfo(bytes);
  expect(!info.title && !info.author, `title "${info.title}", author "${info.author}" still there`);
  return [`title and author removed`];
});

await test("Images to PDF: 5 formats on A4", "images-to-pdf", async (page) => {
  const inputs = [F("photo-large.jpg"), F("alpha.png"), F("photo.webp"), F("photo.bmp"), F("tiny.gif")];
  await page.setInputFiles("#fileInput", inputs);
  await page.locator("#fileList li").nth(inputs.length - 1).waitFor({ timeout: 30_000 });
  await page.selectOption("#pageSelect", "a4");
  await page.selectOption("#marginSelect", "18");
  await page.click("#convertBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#pdfBtn"), "images.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 5, `expected 5 pages, got ${info.pages}`);
  // Wide images get a landscape A4 page, tall ones a portrait page.
  for (const s of info.sizes) {
    const [short, long] = [Math.min(s.width, s.height), Math.max(s.width, s.height)];
    expect(Math.abs(short - 595.28) < 1 && Math.abs(long - 841.89) < 1, `page is ${s.width}x${s.height}, not A4`);
    expect(s.width > s.height, `wide image got a portrait page (${s.width}x${s.height})`);
  }
  return [`5 landscape A4 pages from wide JPG, PNG, WebP, BMP and GIF`];
});

await test("Images to PDF: same size as each image", "images-to-pdf", async (page) => {
  await page.setInputFiles("#fileInput", [F("photo.webp"), F("alpha.png")]);
  await page.locator("#fileList li").nth(1).waitFor({ timeout: 30_000 });
  await page.locator("#fileList li").nth(1).locator('[data-move="-1"]').click();
  await page.selectOption("#pageSelect", "fit");
  await page.selectOption("#marginSelect", "0");
  await page.click("#convertBtn");
  await waitForResult(page);
  const { bytes } = await download(page, page.locator("#pdfBtn"), "images-fit.pdf");
  const info = await pdfInfo(bytes);
  expect(info.pages === 2, `expected 2 pages, got ${info.pages}`);
  const [a, b] = info.sizes;
  expect(Math.abs(a.width / a.height - 1.5) < 0.02 && Math.abs(b.width / b.height - 1.5) < 0.02, "page shapes don't match the images");
  return [`2 pages shaped like the images, reordered`];
});

await test("Image converter: JPG and PNG to WebP", "image-converter", async (page) => {
  await page.setInputFiles("#fileInput", [F("photo-large.jpg"), F("alpha.png")]);
  await page.locator("#fileList li").nth(1).waitFor({ timeout: 30_000 });
  await page.selectOption("#formatSelect", "webp");
  await page.click("#convertBtn");
  await waitForResult(page);
  const links = page.locator("#fileList li a[href]");
  await links.nth(1).waitFor({ timeout: JOB_TIMEOUT });
  const out = [];
  for (let i = 0; i < 2; i++) {
    const { bytes, name } = await download(page, links.nth(i), `converted-${i}.webp`);
    const info = imageInfo(bytes);
    expect(info.type === "webp", `${name} is ${info.type}`);
    out.push(`${name} ${info.width}x${info.height}`);
  }
  expect(out[0].endsWith("2400x1600") && out[1].endsWith("600x400"), `sizes changed: ${out}`);
  return out;
});

await test("Image converter: WebP to JPG", "image-converter", async (page) => {
  await page.setInputFiles("#fileInput", F("photo.webp"));
  await page.locator("#fileList li").first().waitFor({ timeout: 30_000 });
  await page.selectOption("#formatSelect", "jpeg");
  await page.click("#convertBtn");
  await waitForResult(page);
  const { bytes, name } = await download(page, page.locator("#singleDownloadBtn"), "converted.jpg");
  const info = imageInfo(bytes);
  expect(info.type === "jpg" && info.width === 1200, `got ${info.type} ${info.width}x${info.height}`);
  return [`${name} ${info.width}x${info.height}`];
});

await test("Image size reducer: 50% JPG", "image-size-reducer", async (page) => {
  const input = await fs.readFile(F("photo-large.jpg"));
  await page.setInputFiles("#fileInput", F("photo-large.jpg"));
  await page.locator("#fileList li").first().waitFor({ timeout: 30_000 });
  await page.selectOption("#unitSelect", "percent");
  await page.fill("#widthInput", "50");
  await page.press("#widthInput", "Tab");
  await page.click("#compressBtn");
  await waitForResult(page);
  const { bytes, name } = await download(page, page.locator("#singleDownloadBtn"), "reduced.jpg");
  const info = imageInfo(bytes);
  expect(info.width === 1200 && info.height === 800, `got ${info.width}x${info.height}`);
  expect(bytes.length < input.length, "output is not smaller");
  return [`${name} ${info.width}x${info.height}, ${(input.length / 1024).toFixed(0)} KB to ${(bytes.length / 1024).toFixed(0)} KB`];
});

await test("Image size reducer: PNG to WebP", "image-size-reducer", async (page) => {
  await page.setInputFiles("#fileInput", F("alpha.png"));
  await page.locator("#fileList li").first().waitFor({ timeout: 30_000 });
  await page.selectOption("#formatSelect", "webp");
  await page.click("#compressBtn");
  await waitForResult(page);
  const { bytes, name } = await download(page, page.locator("#singleDownloadBtn"), "reduced.webp");
  const info = imageInfo(bytes);
  expect(info.type === "webp", `got ${info.type}`);
  return [`${name} ${info.type} ${info.width}x${info.height}`];
});

await test("Image crop: exact box 400x300", "image-crop-rotate", async (page) => {
  await page.setInputFiles("#fileInput", F("photo.webp"));
  await page.locator("#cropW").waitFor({ state: "visible", timeout: 30_000 });
  for (const [id, v] of [["cropX", "100"], ["cropY", "100"], ["cropW", "400"], ["cropH", "300"]]) {
    await page.fill(`#${id}`, v);
    await page.press(`#${id}`, "Tab");
  }
  await page.selectOption("#formatSelect", "png");
  await page.click("#saveBtn");
  await waitForResult(page);
  const { bytes, name } = await download(page, page.locator("#downloadBtn"), "cropped.png");
  const info = imageInfo(bytes);
  expect(info.type === "png" && info.width === 400 && info.height === 300, `got ${info.type} ${info.width}x${info.height}`);
  return [`${name} ${info.width}x${info.height}`];
});

await test("Image crop: rotate right and flip", "image-crop-rotate", async (page) => {
  await page.setInputFiles("#fileInput", F("photo.webp"));
  await page.locator("#rotateRightBtn").waitFor({ state: "visible", timeout: 30_000 });
  await page.click("#rotateRightBtn");
  await page.click("#flipHBtn");
  await page.selectOption("#formatSelect", "jpeg");
  await page.click("#saveBtn");
  await waitForResult(page);
  const { bytes, name } = await download(page, page.locator("#downloadBtn"), "rotated.jpg");
  const info = imageInfo(bytes);
  expect(info.width === 800 && info.height === 1200, `got ${info.width}x${info.height}, expected 800x1200`);
  return [`${name} ${info.width}x${info.height}`];
});

await test("Image crop: GIF and BMP open", "image-crop-rotate", async (page) => {
  const out = [];
  for (const f of ["tiny.gif", "photo.bmp"]) {
    await page.setInputFiles("#fileInput", F(f));
    await page.locator("#saveBtn").waitFor({ state: "visible", timeout: 30_000 });
    await page.click("#saveBtn");
    await waitForResult(page);
    const { bytes, name } = await download(page, page.locator("#downloadBtn"), `crop-${f}.out`);
    const info = imageInfo(bytes);
    out.push(`${f} saved as ${name} (${info.type} ${info.width}x${info.height})`);
    await page.click("#newBtn");
  }
  return out;
});

for (const keep of [true, false]) {
  await test(`Image metadata: strip, ${keep ? "keep" : "drop"} orientation`, "image-metadata", async (page) => {
    const files = ["exif.jpg", "exif.png", "exif.webp"];
    for (const f of files) {
      const input = await fs.readFile(R(f));
      expect(hasImageMetadata(input, f.split(".")[1]), `fixture ${f} has no metadata to remove`);
    }
    await page.setInputFiles("#fileInput", files.map(R));
    await page.locator("#fileList li").nth(2).waitFor({ timeout: 30_000 });
    if (!keep) await page.uncheck("#keepOrientation");
    await page.click("#stripBtn");
    await waitForResult(page);
    const links = page.locator("#fileList li a[href]");
    await links.nth(2).waitFor({ timeout: JOB_TIMEOUT });
    const out = [];
    for (let i = 0; i < 3; i++) {
      const { bytes, name } = await download(page, links.nth(i), `stripped-${keep ? "keep" : "drop"}-${files[i]}`);
      const type = files[i].split(".")[1];
      const tags = { jpg: jpegExifTags, png: pngExifTags, webp: webpExifTags }[type](bytes);
      const expected = keep ? "274" : "";
      expect(tags.join(",") === expected, `${name} EXIF tags left: [${tags}], expected [${expected}]`);
      const raw = Buffer.from(bytes).toString("latin1");
      if (type === "png") expect(!/(tEXt|iTXt|zTXt)/.test(raw), `${name} still has text chunks`);
      if (type === "webp") expect(!raw.includes("XMP "), `${name} still has XMP`);
      if (type === "jpg") expect(!raw.includes("http://ns.adobe.com/xap"), `${name} still has XMP`);
      out.push(`${name}: ${keep ? "only the orientation tag left" : "no EXIF left"}`);
      const info = imageInfo(bytes);
      const src = imageInfo(await fs.readFile(R(files[i])));
      expect(info.width === src.width && info.height === src.height, `${name} pixel size changed`);
    }
    out.push(`summary: "${(await page.locator("#fileList li").first().innerText()).replace(/\s+/g, " ").slice(0, 80)}"`);
    return out;
  });
}

// Optional: drop .heic files in fixtures/extra to test HEIC decoding.
const extra = await fs.readdir(path.join(FIX, "extra")).catch(() => []);
const heic = extra.filter((f) => /\.hei[cf]$/i.test(f)).map((f) => path.join(FIX, "extra", f));
if (heic.length) {
  await test("Image converter: HEIC to JPG", "image-converter", async (page) => {
    await page.setInputFiles("#fileInput", heic[0]);
    await page.locator("#fileList li").first().waitFor({ timeout: 30_000 });
    await page.selectOption("#formatSelect", "jpeg");
    await page.click("#convertBtn");
    await waitForResult(page);
    const { bytes, name } = await download(page, page.locator("#singleDownloadBtn"), "heic.jpg");
    const info = imageInfo(bytes);
    expect(info.type === "jpg", `got ${info.type}`);
    return [`${name} ${info.width}x${info.height}`];
  });
}

// Layout pass: every page at phone, tablet and laptop widths, light and dark.
const layout = { name: "Layout pass", pages: 0, problems: [] };
for (const theme of ["light", "dark"]) {
  for (const [label, width] of [["phone", 390], ["tablet", 820], ["laptop", 1440]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    for (const tool of [null, ...TOOLS]) {
      const { page, log } = await openTool(context, tool);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const name = `${tool || "home"}-${label}-${theme}`;
      if (overflow > 0) layout.problems.push(`${name}: page scrolls sideways by ${overflow}px`);
      if (log.pageErrors.length) layout.problems.push(`${name}: ${log.pageErrors.join("; ")}`);
      const errs = log.console.filter((l) => l.startsWith("error"));
      if (errs.length) layout.problems.push(`${name}: ${errs.join("; ")}`);
      if (log.failedRequests.length) layout.problems.push(`${name}: failed ${log.failedRequests.join("; ")}`);
      await page.screenshot({ path: path.join(SHOTS, "layout", `${name}.png`), fullPage: tool === null });
      layout.pages++;
      await page.close();
    }
    await context.close();
  }
}
console.log(`${layout.problems.length ? "FAIL" : "PASS"}  Layout pass (${layout.pages} page views)`);
for (const p of layout.problems) console.log("      " + p);

// Home page filter and search.
await test("Home: filter and search", null, async (page) => {
  const visible = () => page.locator(".tool-link:visible").count();
  const all = await visible();
  await page.click('button:has-text("PDF")');
  const pdf = await visible();
  await page.click('button:has-text("Images")');
  const img = await visible();
  await page.click('button:has-text("All")');
  await page.keyboard.press("/");
  const focused = await page.evaluate(() => document.activeElement?.type === "search");
  await page.keyboard.type("merge");
  const search = await visible();
  await page.fill('input[type="search"]', "password");
  const group = await visible();
  expect(all === 11 && pdf === 7 && img === 4, `counts all ${all}, pdf ${pdf}, images ${img}`);
  expect(search === 1, `search "merge" shows ${search} tools`);
  expect(group === 4, `search "password" shows ${group} tools, expected the 4 in its group`);
  expect(focused, `"/" did not focus the search box`);
  return [`All 11, PDF 7, Images 4`, `"/" focuses search; "merge" finds 1; "password" finds its group of 4`];
});

await browser.close();

// ---------- report ----------
const passed = results.filter((r) => r.ok).length;
const lines = [
  `# Browser test results`,
  ``,
  `Site: ${BASE}`,
  `Run: ${new Date().toISOString()}`,
  ``,
  `${passed} of ${results.length} tool tests passed. Layout pass: ${layout.problems.length ? layout.problems.length + " problem(s)" : "no problems"} across ${layout.pages} page views.`,
  ``,
  `| Result | Test | Time | Details |`,
  `| --- | --- | --- | --- |`,
  ...results.map((r) => `| ${r.ok ? "Pass" : "**Fail**"} | ${r.name} | ${(r.ms / 1000).toFixed(1)}s | ${(r.ok ? r.details : [r.error]).join("; ").replace(/\|/g, "/")} |`),
  ``,
];
if (layout.problems.length) lines.push(`## Layout problems`, ``, ...layout.problems.map((p) => `- ${p}`), ``);
const noisy = results.filter((r) => r.log.console.length || r.log.pageErrors.length || r.log.failedRequests.length);
if (noisy.length) {
  lines.push(`## Console and network`, ``);
  for (const r of noisy) {
    lines.push(`### ${r.name}`, ...[...r.log.pageErrors, ...r.log.console, ...r.log.failedRequests].map((l) => `- ${l.replace(/\n/g, " ")}`), ``);
  }
}
await fs.writeFile(path.join(OUT, "report.md"), lines.join("\n"));
await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, results, layout }, null, 2));
console.log(`\n${passed} of ${results.length} passed. Report: results/report.md`);
process.exitCode = passed === results.length && !layout.problems.length ? 0 : 1;
