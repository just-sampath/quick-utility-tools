import {
  initTheme,
  formatBytes,
  createJobRunner,
  createStatus,
  downloadName,
  bindDropzone,
} from "../../assets/js/common.js";
import { makeZip } from "../../assets/js/zip.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const options = document.getElementById("options");
const qualityInput = document.getElementById("qualityInput");
const unitSelect = document.getElementById("unitSelect");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const widthUnit = document.getElementById("widthUnit");
const heightUnit = document.getElementById("heightUnit");
const lockBtn = document.getElementById("lockBtn");
const dpiInput = document.getElementById("dpiInput");
const formatSelect = document.getElementById("formatSelect");
const compressBtn = document.getElementById("compressBtn");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const statSaved = document.getElementById("statSaved");
const sizeNote = document.getElementById("sizeNote");
const dpiNote = document.getElementById("dpiNote");
const resultFlag = document.getElementById("resultFlag");
const zipBtn = document.getElementById("zipBtn");
const template = document.getElementById("itemTemplate");

const runner = createJobRunner("./compress-worker.js", "module");
const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));

const ERRORS = {
  decode: "Couldn't read this image.",
  avif: "This browser can't open AVIF images.",
  heic: "Couldn't read this HEIC image.",
  engine: "The compression engine failed to load. Check your connection and try again.",
  crashed: "Ran out of memory on this image. Try a smaller size.",
};

let items = [];
let batch = 0;
let zipUrl = null;
let reference = null;
let mixed = false;
let autoFilled = false;
let refToken = 0;
let driver = "w";

const PROBE_BYTES = 524288;

function pngInfo(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info = { animated: false, dpi: 0 };
  let pos = 8;
  while (pos + 8 <= b.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...b.subarray(pos + 4, pos + 8));
    if (type === "IDAT") break;
    if (type === "acTL") info.animated = true;
    if (type === "pHYs" && pos + 17 <= b.length && b[pos + 16] === 1) info.dpi = Math.round(view.getUint32(pos + 8) * 0.0254);
    pos += 12 + len;
  }
  return info;
}

function jpegDpi(b) {
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[pos + 2] << 8) | b[pos + 3];
    const isJfif = marker === 0xe0 && String.fromCharCode(...b.subarray(pos + 4, pos + 8)) === "JFIF" && len >= 16 && pos + 14 <= b.length;
    if (isJfif) {
      const units = b[pos + 11];
      const x = (b[pos + 12] << 8) | b[pos + 13];
      if (units === 1) return x;
      if (units === 2) return Math.round(x * 2.54);
      return 0;
    }
    pos += 2 + len;
  }
  return 0;
}

async function probe(file) {
  const b = new Uint8Array(await file.slice(0, PROBE_BYTES).arrayBuffer());
  const text = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "jpeg", animated: false, dpi: jpegDpi(b) };
  if (text(1, 4) === "PNG") return { kind: "png", ...pngInfo(b) };
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") {
    return { kind: "webp", animated: text(12, 16) === "VP8X" && (b[20] & 2) === 2, dpi: 0 };
  }
  if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") return { kind: "gif" };
  if (text(4, 8) === "ftyp") {
    if (text(8, 32).includes("avif") || text(8, 12) === "avis") return { kind: "avif", animated: false, dpi: 0 };
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text(8, 12))) return { kind: "heic", animated: false, dpi: 0 };
  }
  return { kind: null };
}

function isLocked() {
  return lockBtn.getAttribute("aria-pressed") === "true";
}

function setLocked(on) {
  lockBtn.setAttribute("aria-pressed", String(on));
  lockBtn.querySelector(".icon-locked").hidden = !on;
  lockBtn.querySelector(".icon-unlocked").hidden = on;
}

function numberOf(input) {
  const v = input.value.trim();
  return v === "" ? 0 : Number(v);
}

function syncLinked() {
  if (!isLocked()) return;
  const from = driver === "w" ? widthInput : heightInput;
  const to = driver === "w" ? heightInput : widthInput;
  const v = numberOf(from);
  if (!(v > 0)) return;
  if (unitSelect.value === "percent") {
    to.value = String(v);
  } else if (mixed) {
    to.value = "";
  } else if (reference) {
    const ratio = driver === "w" ? reference.height / reference.width : reference.width / reference.height;
    to.value = String(Math.max(1, Math.round(v * ratio)));
  } else {
    to.value = "";
  }
}

function updateSizeNote() {
  const pixels = unitSelect.value === "pixels";
  let text = "";
  if (pixels && mixed) {
    text = isLocked()
      ? `These images have different shapes. Each one is scaled to the ${driver === "w" ? "width" : "height"} you enter and keeps its own aspect ratio, so the ${driver === "w" ? "heights" : "widths"} differ.`
      : "These images have different shapes. Every image is resized to exactly this width and height, so some will look stretched.";
  }
  sizeNote.textContent = text;
  sizeNote.hidden = !text;
}

function changeUnit() {
  const pixels = unitSelect.value === "pixels";
  const w = numberOf(widthInput);
  const h = numberOf(heightInput);
  widthUnit.textContent = heightUnit.textContent = pixels ? "px" : "%";
  autoFilled = false;
  if (reference) {
    if (pixels) {
      autoFilled = (w || 100) === 100 && (h || 100) === 100;
      widthInput.value = String(Math.max(1, Math.round((reference.width * (w || 100)) / 100)));
      heightInput.value = mixed && isLocked() ? "" : String(Math.max(1, Math.round((reference.height * (h || 100)) / 100)));
    } else {
      widthInput.value = String(Math.max(1, Math.round(((w || reference.width) / reference.width) * 100)));
      heightInput.value = String(Math.max(1, Math.round(((h || reference.height) / reference.height) * 100)));
    }
  } else {
    widthInput.value = pixels ? "" : "100";
    heightInput.value = pixels ? "" : "100";
  }
  widthInput.placeholder = heightInput.placeholder = pixels ? "Auto" : "";
  updateSizeNote();
}

function readDims(file) {
  return createImageBitmap(file, { imageOrientation: "from-image" }).then(
    (bitmap) => {
      const dims = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dims;
    },
    () => null,
  );
}

function updateDpiNote() {
  const known = items.map((i) => i.dpi).filter((d) => d > 0);
  let text = "";
  if (known.length) {
    const lo = Math.min(...known);
    const hi = Math.max(...known);
    const who = items.length > 1 ? "Original files" : "Original";
    text = lo === hi ? `${who}: ${lo} DPI.` : `${who}: ${lo} to ${hi} DPI.`;
    text += " The result has no resolution unless you enter one.";
  }
  dpiNote.textContent = text;
  dpiNote.hidden = !text;
}

async function setReference() {
  const token = ++refToken;
  for (const item of [...items]) {
    if (item.dims !== undefined) continue;
    const dims = await readDims(item.file);
    if (token !== refToken) return;
    item.dims = dims;
  }
  const known = items.filter((i) => i.dims).map((i) => i.dims);
  reference = known[0] || null;
  mixed = known.some((d) => Math.abs(d.width / d.height - known[0].width / known[0].height) > 0.01 * (known[0].width / known[0].height));
  if (unitSelect.value === "pixels") {
    const empty = !numberOf(widthInput) && !numberOf(heightInput);
    if (reference && (empty || autoFilled)) {
      widthInput.value = String(reference.width);
      heightInput.value = mixed && isLocked() ? "" : String(reference.height);
      autoFilled = true;
      driver = "w";
    } else if (!reference && autoFilled) {
      widthInput.value = heightInput.value = "";
      autoFilled = false;
    }
  }
  syncLinked();
  updateSizeNote();
}

function pngColors(quality) {
  if (quality >= 90) return 0;
  if (quality >= 75) return 256;
  return Math.max(16, Math.round(256 * Math.pow(quality / 75, 1.6)));
}

function currentSettings() {
  const unit = unitSelect.value;
  const w = numberOf(widthInput);
  const h = numberOf(heightInput);
  const dpi = numberOf(dpiInput);
  const max = unit === "percent" ? 1000 : 16384;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0 || w > max || h > max) {
    return { error: `Enter whole numbers for width and height, up to ${max}${unit === "percent" ? "%" : " px"}.` };
  }
  if (unit === "pixels" && !w && !h) return { error: "Enter a width or a height in pixels." };
  if (unit === "percent" && (!w || !h)) return { error: "Enter a width and height percentage." };
  const quality = numberOf(qualityInput);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) return { error: "Quality must be a whole number from 1 to 100." };
  if (dpiInput.value.trim() !== "" && (!Number.isInteger(dpi) || dpi < 1 || dpi > 2400)) {
    return { error: "Resolution must be a whole number from 1 to 2400 DPI." };
  }
  return {
    unit,
    width: w,
    height: h,
    lock: isLocked(),
    driver,
    quality,
    colors: pngColors(quality),
    dpi,
    background: document.querySelector('input[name="background"]:checked').value,
    format: formatSelect.value,
  };
}

const ANIM_NOTE = "animated, only the first frame is kept";

function idleText(item) {
  return item.animated ? `${formatBytes(item.file.size)} · ${ANIM_NOTE}` : formatBytes(item.file.size);
}

function setStatus(item, text, kind = "") {
  item.li.classList.toggle("is-error", kind === "error");
  if (kind === "busy") {
    const spin = document.createElement("span");
    spin.className = "spinner";
    spin.setAttribute("aria-hidden", "true");
    item.li.querySelector(".file-meta").after(spin);
    item.spinner = spin;
  }
  item.status.textContent = text;
}

function clearItemResult(item) {
  item.spinner?.remove();
  item.spinner = null;
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
  item.output = null;
  item.saving.hidden = true;
  item.download.hidden = true;
  item.flag.hidden = true;
  item.li.classList.remove("is-error");
}

function addFiles(files) {
  Promise.all(files.map(async (file) => ({ file, ...(await probe(file)) }))).then((sniffed) => {
    const accepted = sniffed.filter((s) => s.kind && s.kind !== "gif");
    const skipped = sniffed.length - accepted.length;
    const gifs = sniffed.filter((s) => s.kind === "gif").length;
    for (const { file, kind, animated, dpi } of accepted) {
      const li = template.content.firstElementChild.cloneNode(true);
      const item = {
        file,
        kind,
        li,
        status: li.querySelector(".file-size"),
        saving: li.querySelector(".saving"),
        download: li.querySelector("a"),
        flag: li.querySelector(".file-flag"),
        animated,
        dpi,
        dims: undefined,
        url: null,
        output: null,
        spinner: null,
      };
      li.querySelector(".file-name").textContent = file.name;
      li.querySelector("button").addEventListener("click", () => removeItem(item));
      setStatus(item, idleText(item));
      items.push(item);
      fileList.append(li);
    }
    if (skipped) {
      const gifNote = gifs ? ` GIF images aren't supported, because only the first frame would be kept.` : "";
      showMsg("error", `Skipped ${skipped} file${skipped > 1 ? "s" : ""} that ${skipped > 1 ? "aren't" : "isn't a"} JPG, PNG, WebP or HEIC image${skipped > 1 ? "s" : ""}.${gifNote}`);
    } else {
      hideMsg();
    }
    refresh();
    updateDpiNote();
    setReference();
  });
}

function removeItem(item) {
  clearItemResult(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  refresh();
  updateDpiNote();
  setReference();
  if (items.some((i) => i.output)) showSummary();
}

function refresh() {
  const has = items.length > 0;
  dz.hidden = has;
  fileList.hidden = !has;
  options.hidden = !has;
  compressBtn.textContent = items.length > 1 ? `Resize ${items.length} Images` : "Resize Image";
  if (!has) result.hidden = true;
}

function busy(on) {
  compressBtn.disabled = on;
  addBtn.disabled = on;
  fileInput.disabled = on;
  for (const item of items) item.li.querySelector("button").disabled = on;
}

function finishItem(item, r) {
  item.spinner?.remove();
  item.spinner = null;
  if (!r.ok) {
    setStatus(item, ERRORS[r.error] || ERRORS.decode, "error");
    return;
  }
  const blob = new Blob([r.bytes], { type: r.type });
  const name = r.kept ? item.file.name : downloadName(item.file.name, "_compressed", r.ext);
  item.output = { blob, name };
  item.url = URL.createObjectURL(blob);
  item.download.href = item.url;
  item.download.download = name;
  item.download.hidden = false;
  const notes = [`${formatBytes(item.file.size)} → ${formatBytes(blob.size)}`, `${r.width}×${r.height}`];
  if (item.animated && !r.kept) notes.push(ANIM_NOTE);
  if (r.dpiSkipped) notes.push("WebP can't store a resolution");
  setStatus(item, notes.join(" · "));
  item.capped = r.capped;
  if (r.capped) {
    item.flag.textContent = `Scaled down to ${r.width}×${r.height} (about 16.7 megapixels, the browser limit). The result is smaller than the size you asked for.`;
    item.flag.hidden = false;
  }
  const pct = Math.min(99, Math.round((1 - blob.size / item.file.size) * 100));
  item.saving.textContent = r.kept ? "Already optimized" : pct > 0 ? `−${pct}%` : `+${-pct}%`;
  item.saving.classList.toggle("is-none", r.kept || pct <= 0);
  item.saving.hidden = false;
}

function showSummary() {
  const done = items.filter((i) => i.output);
  if (!done.length) {
    result.hidden = true;
    return;
  }
  const before = done.reduce((n, i) => n + i.file.size, 0);
  const after = done.reduce((n, i) => n + i.output.blob.size, 0);
  resultTitle.textContent = done.length > 1 ? `${done.length} images ready` : "Image ready";
  statBefore.textContent = formatBytes(before);
  statAfter.textContent = formatBytes(after);
  statSaved.textContent = after < before ? `${formatBytes(before - after)} (${Math.min(99, Math.round((1 - after / before) * 100))}%)` : "nothing";
  const capped = done.filter((i) => i.capped);
  resultFlag.textContent = capped.length
    ? `${capped.length === 1 ? "1 image was" : `${capped.length} images were`} scaled down to about 16.7 megapixels, the browser limit, so ${capped.length === 1 ? "it is" : "they are"} smaller than the size you asked for: ${capped.map((i) => i.file.name).join(", ")}.`
    : "";
  resultFlag.hidden = !capped.length;
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  zipBtn.href = "#";
  zipBtn.hidden = done.length < 2;
  result.hidden = false;
}

async function compressAll() {
  const settings = currentSettings();
  if (settings.error) {
    showMsg("error", settings.error);
    return;
  }
  const id = ++batch;
  busy(true);
  hideMsg();
  result.hidden = true;
  for (const item of items) {
    clearItemResult(item);
    item.capped = false;
    setStatus(item, "Waiting…");
  }
  for (const item of [...items]) {
    if (id !== batch) return;
    setStatus(item, "Reading…", "busy");
    let r;
    try {
      r = await runner.run({ file: item.file, kind: item.kind, settings }, [], (p) => {
        if (id === batch) item.status.textContent = p;
      });
    } catch {
      r = { ok: false, error: "crashed" };
    }
    if (id !== batch) return;
    finishItem(item, r);
  }
  busy(false);
  showSummary();
  if (items.some((i) => !i.output)) showMsg("error", "Some images couldn't be processed. See the list above.");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearAll() {
  batch++;
  runner.cancel();
  for (const item of items) clearItemResult(item);
  items = [];
  refToken++;
  if (autoFilled) widthInput.value = heightInput.value = "";
  reference = null;
  mixed = false;
  autoFilled = false;
  fileList.replaceChildren();
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  busy(false);
  hideMsg();
  refresh();
  updateDpiNote();
  updateSizeNote();
}

if (typeof OffscreenCanvas === "undefined") {
  showMsg("error", "This browser is too old for this tool. Please update it, or try a current version of Chrome, Edge, Firefox or Safari.");
  fileInput.disabled = true;
}

bindDropzone(dz, fileInput, addFiles);
options.addEventListener("dragover", (e) => e.preventDefault());
options.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!compressBtn.disabled && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});

unitSelect.addEventListener("change", changeUnit);
widthInput.addEventListener("input", () => {
  driver = "w";
  autoFilled = false;
  syncLinked();
  updateSizeNote();
  updateSizeNote();
});
heightInput.addEventListener("input", () => {
  driver = "h";
  autoFilled = false;
  syncLinked();
  updateSizeNote();
});
lockBtn.addEventListener("click", () => {
  setLocked(!isLocked());
  syncLinked();
  updateSizeNote();
});

compressBtn.addEventListener("click", compressAll);
addBtn.addEventListener("click", () => fileInput.click());
clearBtn.addEventListener("click", clearAll);

zipBtn.addEventListener("click", (e) => {
  if (zipUrl) return;
  e.preventDefault();
  const used = new Map();
  const files = items
    .filter((i) => i.output)
    .map((i) => {
      let name = i.output.name;
      const n = used.get(name) || 0;
      used.set(name, n + 1);
      if (n) name = name.replace(/(\.[^.]+)$/, ` (${n})$1`);
      return { name, blob: i.output.blob };
    });
  zipBtn.textContent = "Preparing ZIP…";
  Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.blob.arrayBuffer()) }))).then((entries) => {
    zipUrl = URL.createObjectURL(makeZip(entries));
    zipBtn.href = zipUrl;
    zipBtn.download = "compressed-images.zip";
    zipBtn.textContent = "Download all as ZIP";
    zipBtn.click();
  });
});
