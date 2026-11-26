import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const offline = process.argv.includes("--offline");
let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failed++;
  console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

async function section(title, fn) {
  console.log(title);
  try {
    await fn();
  } catch (err) {
    failed++;
    console.log(`  FAIL ${title} threw: ${(err && err.stack) || err}`);
  }
}

function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel, ext));
    else if (rel.endsWith(ext)) out.push(rel);
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const scripts = [...walk("assets", ".js"), ...walk("core", ".js"), ...walk("tools", ".js")];

function localImports(rel, seen = new Set()) {
  if (seen.has(rel)) return seen;
  seen.add(rel);
  for (const m of read(rel).matchAll(/(?:from|import\()\s*"(\.{1,2}\/[^"]+\.js)"/g)) {
    localImports(path.normalize(path.join(path.dirname(rel), m[1])), seen);
  }
  return seen;
}
const pages = ["index.html", ...walk("tools", ".html")];

function staticImports(rel, seen = new Set()) {
  if (seen.has(rel)) return seen;
  seen.add(rel);
  for (const m of read(rel).matchAll(/^\s*(?:import|export)\s[^;]*?from\s*"(\.{1,2}\/[^"]+\.js)"|^\s*import\s*"(\.{1,2}\/[^"]+\.js)"/gm)) {
    staticImports(path.normalize(path.join(path.dirname(rel), m[1] || m[2])), seen);
  }
  return seen;
}
const isClassic = (rel) => /^importScripts\(/m.test(read(rel)) || rel === path.join("assets", "js", "qpdf.js");

await section("Syntax", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qut-syntax-"));
  for (const rel of scripts) {
    const copy = path.join(tmp, "file" + (isClassic(rel) ? ".cjs" : ".mjs"));
    fs.copyFileSync(path.join(ROOT, rel), copy);
    let error = "";
    try {
      execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" });
    } catch (err) {
      error = String(err.stderr || err.message).split("\n").slice(0, 5).join(" ");
    }
    check(`${rel} parses`, !error, error);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

await section("Pages", () => {
  for (const rel of pages) {
    const html = read(rel);
    const csp = (/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html) || [])[1] || "";
    check(`${rel} has a CSP that starts from default-src 'none'`, csp.startsWith("default-src 'none'"));
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      const hash = createHash("sha256").update(m[1].replace(/\r\n/g, "\n")).digest("base64");
      check(`${rel} inline script hash is in the CSP`, csp.includes(`'sha256-${hash}'`), `sha256-${hash}`);
    }
    check(`${rel} has no inline styles`, !/\sstyle="|<style[\s>]/i.test(html));
    check(`${rel} has the color-scheme meta`, html.includes('<meta name="color-scheme" content="light dark">'));
    const dir = path.dirname(rel);
    const workers = dir === "." ? [] : fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith("-worker.js"));
    const engine = workers.some((w) => /qpdf\.js|codecs\.js/.test(read(path.join(dir, w))));
    const cdn = csp.includes("https://cdn.jsdelivr.net") && csp.includes("'wasm-unsafe-eval'") && csp.includes("worker-src 'self'");
    check(`${rel} CSP ${engine ? "allows" : "does not allow"} the engine CDN`, engine ? cdn : !/jsdelivr|wasm-unsafe-eval|worker-src/.test(csp));
    const entry = (/<script type="module" src="([^"]+)"/.exec(html) || [])[1];
    if (entry) {
      const want = [...staticImports(path.normalize(path.join(dir, entry)))].slice(1).sort();
      const have = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => path.normalize(path.join(dir, m[1]))).sort();
      check(`${rel} preloads exactly its static module imports`, want.join() === have.join(), `want ${want.join(", ")}; have ${have.join(", ")}`);
    }
    if (dir === ".") continue;
    const files = new Set();
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".js"))) localImports(path.join(dir, f), files);
    const js = [...files].map(read).join("\n");
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of js.matchAll(/(?:getElementById|\$)\("([^"]+)"\)/g)) check(`${rel} has #${m[1]}`, ids.has(m[1]), `needed by ${[...files].filter((f) => read(f).includes(m[0])).join(", ")}`);
    if (files.has(path.join("core", "image", "file-list.js"))) {
      const item = (/<template id="itemTemplate">([\s\S]*?)<\/template>/.exec(html) || [])[1] || "";
      for (const part of ["file-meta", "file-name", "file-size", "saving", "<a ", "data-remove"]) check(`${rel} item template has ${part}`, item.includes(part));
    }
  }
});

await section("CDN pins", () => {
  for (const rel of scripts) {
    for (const m of read(rel).matchAll(/cdn\.jsdelivr\.net\/npm\/((?:@[^/@"]+\/)?[^/@"]+)(@[^/"]*)?/g)) {
      check(`${rel} pins ${m[1]} to an exact version`, /^@\d+\.\d+\.\d+$/.test(m[2] || ""), m[0]);
    }
  }
});

const importModule = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const fixture = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

await section("ZIP writer", async () => {
  const { crc32, makeZip } = await importModule("assets/js/zip.js");
  check("crc32 check value", crc32(ascii("123456789")) === 0xcbf43926);
  const zip = new Uint8Array(await makeZip([{ name: "a.txt", bytes: ascii("hello") }, { name: "b.txt", bytes: ascii("") }]).arrayBuffer());
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  check("ZIP ends with an end-of-central-directory record", view.getUint32(end, true) === 0x06054b50);
  check("ZIP lists both files", view.getUint16(end + 10, true) === 2);
  check("ZIP local header CRC", view.getUint32(14, true) === crc32(ascii("hello")));
});

await section("Image sniffing", async () => {
  const { sniffImage, capSize, MAX_PIXELS } = await importModule("assets/js/codecs.js");
  check("JPEG", sniffImage(fixture("exif.jpg")).kind === "jpeg");
  check("PNG", sniffImage(fixture("exif.png")).kind === "png");
  check("WebP", sniffImage(fixture("exif.webp")).kind === "webp");
  check("GIF", sniffImage(ascii("GIF89a\0\0\0\0\0\0")).kind === "gif");
  check("HEIC", sniffImage(ascii("\0\0\0\x18ftypheic\0\0\0\0mif1heic")).kind === "heic");
  check("AVIF before HEIC brands", sniffImage(ascii("\0\0\0\x1cftypmif1\0\0\0\0avifmiaf")).kind === "avif");
  check("unknown", sniffImage(ascii("hello world, not an image")).kind === null);
  const big = capSize(8000, 6000);
  check("capSize keeps small images", !capSize(4000, 3000).capped);
  check("capSize scales large images under the limit", big.capped && big.width * big.height <= MAX_PIXELS);
});

await section("Image metadata", async () => {
  const { readMetadata, stripMetadata } = await importModule("tools/image-metadata/metadata.js");
  for (const name of ["exif.jpg", "exif.png", "exif.webp"]) {
    const bytes = fixture(name);
    const meta = readMetadata(bytes);
    const labels = meta.ok ? meta.groups.map((g) => g.id) : [];
    check(`${name} is read`, meta.ok, meta.error);
    check(`${name} shows EXIF and GPS`, labels.includes("exif") && labels.includes("gps"), labels.join(","));
    check(`${name} orientation`, meta.orientation === 6);
    const kept = stripMetadata(bytes, { keepOrientation: true });
    const keptMeta = readMetadata(kept.bytes);
    check(`${name} strip keeps only orientation`, kept.changed && keptMeta.orientation === 6 && !keptMeta.groups.some((g) => g.id === "gps"));
    const dropped = stripMetadata(bytes, { keepOrientation: false });
    const droppedMeta = readMetadata(dropped.bytes);
    check(`${name} strip removes everything`, droppedMeta.ok && droppedMeta.groups.length === 0 && droppedMeta.orientation === 1);
    check(`${name} strip of a clean file changes nothing`, stripMetadata(dropped.bytes, { keepOrientation: false }).changed === false);
  }
});

async function cachedEngine() {
  const base = (/QPDF_BASE = "([^"]+)"/.exec(read("assets/js/qpdf.js")) || [])[1];
  const version = (/qpdf-wasm@([^/]+)\//.exec(base) || [])[1];
  const dir = path.join(os.tmpdir(), "quick-utility-tools-check", `qpdf-wasm-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ["qpdf.js", "qpdf.wasm"]) {
    const local = path.join(dir, file);
    if (fs.existsSync(local)) continue;
    if (offline) throw new Error(`${local} is not cached; run once without --offline`);
    const res = await fetch(base + file);
    if (!res.ok) throw new Error(`download failed: ${base + file} (${res.status})`);
    fs.writeFileSync(local + ".part", Buffer.from(await res.arrayBuffer()));
    fs.renameSync(local + ".part", local);
  }
  return { base, dir };
}

function loadWorker(rel, engine) {
  const file = path.join(ROOT, rel);
  const local = (url) => (url.startsWith(engine.base) ? path.join(engine.dir, url.slice(engine.base.length)) : fileURLToPath(url));
  const pending = new Map();
  const ctx = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    location: { href: pathToFileURL(file).href },
    fetch: async (url) => new Response(fs.readFileSync(local(String(url))), { headers: { "content-type": "application/wasm" } }),
    importScripts: (...urls) => {
      for (const url of urls) {
        const target = local(new URL(url, pathToFileURL(file)).href);
        vm.runInContext(fs.readFileSync(target, "utf8"), ctx, { filename: target });
      }
    },
    postMessage: (msg) => {
      if ("progress" in msg) return;
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  let nextId = 0;
  const run = (payload) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ctx.self.onmessage({ data: { ...payload, id } });
    });
  return { run, qpdf: () => ctx.loadQpdf() };
}

const buf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

function inspectPdf(q, bytes, password = "") {
  try {
    q.FS.mkdir("/t");
  } catch {}
  q.FS.writeFile("/t/in.pdf", bytes);
  const pw = password ? ["--password=" + password] : [];
  const code = q.callMain([...pw, "--json=2", "--json-key=encrypt", "--json-key=pages", "--json-key=qpdf", "--json-stream-data=none", "/t/in.pdf", "/t/out.json"]);
  if (code !== 0 && code !== 3) return null;
  const json = JSON.parse(new TextDecoder().decode(q.FS.readFile("/t/out.json")));
  const objects = json.qpdf[1];
  const info = objects[`obj:${objects.trailer.value["/Info"]}`]?.value || {};
  return {
    encrypted: json.encrypt.encrypted,
    capabilities: json.encrypt.capabilities,
    pages: json.pages.map((p) => objects[`obj:${p.object}`].value),
    info,
  };
}

async function samplePdf() {
  const { createPdf } = await importModule("tools/images-to-pdf/pdf-writer.js");
  const pdf = createPdf();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const infoId = pdf.reserve();
  const imageId = pdf.reserve();
  const pageIds = [];
  pdf.object(imageId, "/Type /XObject /Subtype /Image /Width 40 /Height 30 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", fixture("exif.jpg"));
  for (let i = 0; i < 3; i++) {
    const contentId = pdf.reserve();
    const pageId = pdf.reserve();
    const draw = i === 0 ? "q 300 0 0 225 50 400 cm /Im0 Do Q" : `q 0 0 1 rg 50 50 ${100 * (i + 1)} 100 re f Q`;
    pdf.object(contentId, "", new TextEncoder().encode(draw));
    const resources = i === 0 ? `<< /XObject << /Im0 ${imageId} 0 R >> >>` : "<< >>";
    pdf.object(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  pdf.object(pagesId, `<< /Type /Pages /Count 3 /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] >>`);
  pdf.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(infoId, "<< /Producer (Quick Utility Tools) /Title (Sample) /Author (Tester) >>");
  return new Uint8Array(await pdf.finish(catalogId, infoId).arrayBuffer());
}

async function longPdf(count) {
  const { createPdf } = await importModule("tools/images-to-pdf/pdf-writer.js");
  const pdf = createPdf();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const infoId = pdf.reserve();
  const pageIds = [];
  for (let i = 0; i < count; i++) {
    const contentId = pdf.reserve();
    const pageId = pdf.reserve();
    pdf.object(contentId, "", new TextEncoder().encode(`q 0 0 1 rg 50 50 ${10 + i} 100 re f Q`));
    pdf.object(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  pdf.object(pagesId, `<< /Type /Pages /Count ${count} /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] >>`);
  pdf.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(infoId, "<< /Producer (Quick Utility Tools) >>");
  return new Uint8Array(await pdf.finish(catalogId, infoId).arrayBuffer());
}

await section("PDF tools (real worker files on the pinned qpdf build)", async () => {
  const engine = await cachedEngine();
  const plain = await samplePdf();
  const remover = loadWorker("tools/pdf-password-remover/decrypt-worker.js", engine);
  const adder = loadWorker("tools/pdf-password-adder/encrypt-worker.js", engine);
  const mergeSplit = loadWorker("tools/pdf-merge-split/merge-split-worker.js", engine);
  const organizer = loadWorker("tools/pdf-page-organizer/organize-worker.js", engine);
  const metadata = loadWorker("tools/pdf-metadata-editor/metadata-worker.js", engine);
  const reducer = loadWorker("tools/pdf-size-reducer/compress-worker.js", engine);
  const q = await remover.qpdf();

  q.FS.writeFile("/check.pdf", plain);
  check("Images to PDF writer output passes qpdf --check", q.callMain(["--check", "/check.pdf"]) === 0);

  const password = "-dash and spaces";
  const locked = await adder.run({ bytes: buf(plain), password, ownerPassword: "" });
  check("adder accepts a password that starts with a dash", locked.ok, JSON.stringify(locked));
  if (!locked.ok) return;
  const user = new Uint8Array(locked.bytes);
  check("adder output needs the password", inspectPdf(q, user) === null && inspectPdf(q, user, password)?.encrypted === true);
  check("adder output allows everything by default", Object.values(inspectPdf(q, user, password).capabilities).every(Boolean));

  const restricted = await adder.run({ bytes: buf(plain), password: "open", ownerPassword: "owner", permissions: { print: false, copy: false, edit: false } });
  const caps = restricted.ok ? inspectPdf(q, new Uint8Array(restricted.bytes), "open").capabilities : {};
  check("adder blocks printing", restricted.ok && !caps.printhigh && !caps.printlow, JSON.stringify(caps));
  check("adder blocks copying", restricted.ok && !caps.extract);
  check("adder blocks editing", restricted.ok && !caps.modify && !caps.modifyannotations && !caps.modifyforms && !caps.modifyassembly);
  const ownerOnly = await adder.run({ bytes: buf(plain), password: "", ownerPassword: "owner", permissions: { print: false } });
  const owner = new Uint8Array(ownerOnly.bytes);
  check("owner-only fixture opens without a password", ownerOnly.ok && inspectPdf(q, owner)?.encrypted === true);
  check("adder rejects a PDF that needs a password", (await adder.run({ bytes: buf(user), password: "x" })).alreadyEncrypted === true);
  check("adder rejects an owner-only PDF", (await adder.run({ bytes: buf(owner), password: "x" })).alreadyEncrypted === true);
  check("adder check accepts an unencrypted PDF", (await adder.run({ op: "check", bytes: buf(plain) })).ok === true);
  check("adder check rejects encrypted PDFs", (await adder.run({ op: "check", bytes: buf(user) })).alreadyEncrypted === true && (await adder.run({ op: "check", bytes: buf(owner) })).alreadyEncrypted === true);

  const damaged = ascii("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n");
  let r = await remover.run({ bytes: buf(user), password: "" });
  check("remover asks for a password", r.needsPassword === true);
  r = await remover.run({ bytes: buf(user), password: "wrong" });
  check("remover reports a wrong password", r.wrongPassword === true);
  r = await remover.run({ bytes: buf(user), password });
  check("remover decrypts with the right password", r.ok && inspectPdf(q, new Uint8Array(r.bytes))?.encrypted === false);
  r = await remover.run({ bytes: buf(owner), password: "" });
  check("remover unlocks an owner-only PDF without a password", r.ok && inspectPdf(q, new Uint8Array(r.bytes))?.encrypted === false);
  r = await remover.run({ bytes: buf(damaged), password: "" });
  check("remover treats a damaged file as damaged, not as a password problem", !r.needsPassword && !r.wrongPassword && !r.fatal, JSON.stringify(r));

  r = await mergeSplit.run({ op: "inspect", bytes: buf(plain), password: "" });
  check("merge/split counts pages", r.ok && r.pages === 3);
  r = await mergeSplit.run({ op: "inspect", bytes: buf(user), password: "" });
  check("merge/split asks for a password", r.needsPassword === true);
  r = await mergeSplit.run({
    op: "build",
    files: [{ bytes: buf(plain), password: "" }, { bytes: buf(user), password }],
    outputs: [[{ file: 0, range: "1-z" }, { file: 1, range: "1-z" }], [{ file: 0, range: "2-3" }], [{ file: 1, range: "z" }]],
  });
  const counts = r.ok ? r.results.map((b) => inspectPdf(q, new Uint8Array(b))?.pages.length) : [];
  check("merge, split and extract page counts", counts.join(",") === "6,2,1", counts.join(","));

  r = await organizer.run({ op: "inspect", bytes: buf(plain), password: "" });
  check("organizer lists pages", r.ok && r.pages.length === 3 && r.pages[0].w === 612);
  check("organizer exports the JPEG thumbnail of page 1 only", r.ok && Boolean(r.pages[0].thumb) && !r.pages[1].thumb && Object.keys(r.thumbs).length === 1);
  r = await organizer.run({ op: "build", bytes: buf(user), password, order: [{ page: 3, rotate: 90 }, { page: 1, rotate: 0 }] });
  const organized = r.ok ? inspectPdf(q, new Uint8Array(r.bytes), password) : null;
  check("organizer reorders, rotates and deletes", organized?.pages.length === 2 && organized.pages[0]["/Rotate"] === 90 && !organized.pages[1]["/Rotate"]);
  check("organizer keeps the password", organized?.encrypted === true);

  r = await metadata.run({ op: "read", bytes: buf(plain), password: "" });
  check("metadata reads the Info dictionary", r.ok && r.fields["/Title"] === "Sample" && r.fields["/Author"] === "Tester" && !r.hasXmp);
  r = await metadata.run({ op: "write", bytes: buf(plain), password: "", changes: { "/Title": "Café ✓", "/Author": "" } });
  const edited = r.ok ? await metadata.run({ op: "read", bytes: r.bytes, password: "" }) : {};
  check("metadata writes non-ASCII text and clears fields", edited.fields?.["/Title"] === "Café ✓" && edited.fields?.["/Author"] === "");
  r = await metadata.run({ op: "strip", bytes: buf(plain), password: "" });
  check("metadata strip removes the Info dictionary", r.ok && (await metadata.run({ op: "read", bytes: r.bytes, password: "" })).hasInfo === false);
  r = await metadata.run({ op: "read", bytes: buf(user), password: "" });
  check("metadata asks for a password", r.needsPassword === true);
  r = await metadata.run({ op: "write", bytes: buf(user), password, changes: { "/Title": "Locked" } });
  check("metadata keeps the password", r.ok && inspectPdf(q, new Uint8Array(r.bytes), password)?.info["/Title"] === "u:Locked");

  r = await reducer.run({ bytes: buf(plain), password: "", preset: "lossless" });
  check("size reducer lossless pass", r.ok && inspectPdf(q, new Uint8Array(r.bytes))?.pages.length === 3);
  r = await reducer.run({ bytes: buf(user), password: "", preset: "lossless" });
  check("size reducer asks for a password", r.needsPassword === true);
  r = await reducer.run({ bytes: buf(user), password, preset: "lossless" });
  check("size reducer keeps the password", r.ok && inspectPdf(q, new Uint8Array(r.bytes), password)?.encrypted === true);

  r = await remover.run({ file: new Blob([plain]), password: "" });
  check("workers accept a File instead of bytes", r.ok && inspectPdf(q, new Uint8Array(r.bytes))?.encrypted === false);

  let repeated = 0;
  for (let k = 0; k < 300; k++) {
    const read = await metadata.run({ op: "read", bytes: buf(plain), password: "" });
    if (read.ok && read.fields["/Title"] === "Sample") repeated++;
  }
  check("300 jobs in a row on one worker all succeed", repeated === 300, `${repeated} of 300`);

  const long = await longPdf(300);
  const every = Array.from({ length: 300 }, (_, i) => [{ file: 0, range: String(i + 1) }]);
  r = await mergeSplit.run({ op: "build", files: [{ bytes: buf(long), password: "" }], outputs: every, split: 1 });
  const isPdf = (b) => new TextDecoder().decode(new Uint8Array(b).subarray(0, 5)) === "%PDF-";
  check("split every page of a 300-page PDF", r.ok && r.results.length === 300 && r.results.every(isPdf), r.ok ? String(r.results.length) : JSON.stringify(r));
  const pageOf = (b) => inspectPdf(q, new Uint8Array(b))?.pages.length;
  check("split pages come out one page each, in order", r.ok && pageOf(r.results[0]) === 1 && pageOf(r.results[299]) === 1 && r.results[0].byteLength > 0);
  const chunks = [];
  for (let a = 1; a <= 300; a += 7) chunks.push([{ file: 0, range: `${a}-${Math.min(a + 6, 300)}` }]);
  r = await mergeSplit.run({ op: "build", files: [{ bytes: buf(long), password: "" }], outputs: chunks, split: 7 });
  check("split into 7-page files", r.ok && r.results.length === 43 && pageOf(r.results[0]) === 7 && pageOf(r.results[42]) === 6);
  r = await mergeSplit.run({ op: "build", files: [{ bytes: buf(user), password }], outputs: [[{ file: 0, range: "1" }], [{ file: 0, range: "2" }], [{ file: 0, range: "3" }]], split: 1 });
  check("split works on a password-protected PDF", r.ok && r.results.length === 3 && inspectPdf(q, new Uint8Array(r.results[2]))?.encrypted === false);
  const many = Array.from({ length: 260 }, (_, i) => [{ file: 0, range: String((i % 300) + 1) }]);
  r = await mergeSplit.run({ op: "build", files: [{ file: new Blob([long]), password: "" }], outputs: many });
  check("260 separate page ranges in one job", r.ok && r.results.length === 260 && r.results.every(isPdf), r.ok ? String(r.results.length) : JSON.stringify(r));

  const { readMetadata, stripMetadata } = await importModule("tools/image-metadata/metadata.js");
  const bare = stripMetadata(fixture("exif.jpg"), { keepOrientation: false }).bytes;
  check("fixture JPEG has no orientation left", readMetadata(bare).orientation === 1);
  const withProfile = (space) => {
    const icc = new Uint8Array(132);
    new DataView(icc.buffer).setUint32(0, 132);
    icc.set(ascii(space), 16);
    icc.set(ascii("acsp"), 36);
    const seg = (seq, data) => {
      const len = 2 + 14 + data.length;
      return Uint8Array.from([0xff, 0xe2, len >> 8, len & 255, ...ascii("ICC_PROFILE\0"), seq, 2, ...data]);
    };
    return new Uint8Array([...bare.subarray(0, 2), ...seg(2, icc.subarray(60)), ...seg(1, icc.subarray(0, 60)), ...bare.subarray(2)]);
  };
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  await importModule("tools/images-to-pdf/convert-worker.js");
  const toPdf = async (jpeg) => {
    posted.length = 0;
    await globalThis.self.onmessage({ data: { id: 1, files: [new Blob([jpeg])], settings: { page: "fit", margin: 0 } } });
    const out = posted.find((m) => m.blob);
    return out ? new Uint8Array(await out.blob.arrayBuffer()) : null;
  };
  const imageSpace = (pdfBytes) => {
    q.FS.writeFile("/t/icc.pdf", pdfBytes);
    if (q.callMain(["--json=2", "--json-key=qpdf", "--json-stream-data=none", "/t/icc.pdf", "/t/icc.json"]) !== 0) return null;
    const objects = JSON.parse(new TextDecoder().decode(q.FS.readFile("/t/icc.json"))).qpdf[1];
    const image = Object.values(objects).find((o) => o.stream?.dict["/Subtype"] === "/Image");
    const cs = image?.stream.dict["/ColorSpace"];
    if (!Array.isArray(cs)) return cs;
    return { cs, profile: objects["obj:" + cs[1]]?.stream?.dict };
  };
  const kept = await toPdf(withProfile("RGB "));
  const space = kept && imageSpace(kept);
  q.FS.writeFile("/t/icc.pdf", kept || new Uint8Array());
  check("Images to PDF keeps a JPEG color profile", space?.cs?.[0] === "/ICCBased" && space.profile?.["/N"] === 3 && space.profile?.["/Alternate"] === "/DeviceRGB", JSON.stringify(space));
  check("Images to PDF output with a profile passes qpdf --check", kept && q.callMain(["--check", "/t/icc.pdf"]) === 0);
  const mismatched = await toPdf(withProfile("GRAY"));
  check("Images to PDF ignores a profile that doesn't match the image", mismatched && imageSpace(mismatched) === "/DeviceRGB");
  delete globalThis.self;
});

await section("ZIP from files on disk", async () => {
  const { crc32, crc32Async, buildZip } = await importModule("assets/js/zip.js");
  const big = new Uint8Array(20 * 1024 * 1024 + 123);
  for (let i = 0; i < big.length; i += 997) big[i] = i & 255;
  check("chunked crc32 matches", (await crc32Async(big)) === crc32(big) && (await crc32Async(new Blob([big]))) === crc32(big));
  const zip = new Uint8Array(await (await buildZip([{ name: "a.txt", blob: new Blob([ascii("hello")]) }, { name: "b.txt", bytes: ascii("world") }])).arrayBuffer());
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  check("ZIP from blobs lists both files", view.getUint32(end, true) === 0x06054b50 && view.getUint16(end + 10, true) === 2);
  check("ZIP from blobs has the right CRC and size", view.getUint32(14, true) === crc32(ascii("hello")) && view.getUint32(18, true) === 5);
  check("ZIP from blobs keeps the data", new TextDecoder().decode(zip.subarray(35, 40)) === "hello");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
