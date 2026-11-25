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
let driver = "w";

async function sniff(file) {
  const b = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const text = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (text(1, 4) === "PNG") return "png";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "webp";
  if (text(4, 8) === "ftyp") {
    if (text(8, 32).includes("avif") || text(8, 12) === "avis") return "avif";
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text(8, 12))) return "heic";
  }
  return null;
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
  } else if (reference) {
    const ratio = driver === "w" ? reference.height / reference.width : reference.width / reference.height;
    to.value = String(Math.max(1, Math.round(v * ratio)));
  } else {
    to.value = "";
  }
}

function changeUnit() {
  const pixels = unitSelect.value === "pixels";
  const w = numberOf(widthInput);
  const h = numberOf(heightInput);
  widthUnit.textContent = heightUnit.textContent = pixels ? "px" : "%";
  if (reference) {
    if (pixels) {
      widthInput.value = String(Math.max(1, Math.round((reference.width * (w || 100)) / 100)));
      heightInput.value = String(Math.max(1, Math.round((reference.height * (h || 100)) / 100)));
    } else {
      widthInput.value = String(Math.max(1, Math.round(((w || reference.width) / reference.width) * 100)));
      heightInput.value = String(Math.max(1, Math.round(((h || reference.height) / reference.height) * 100)));
    }
  } else {
    widthInput.value = pixels ? "" : "100";
    heightInput.value = pixels ? "" : "100";
  }
  widthInput.placeholder = heightInput.placeholder = pixels ? "Auto" : "";
}

async function setReference() {
  reference = null;
  for (const item of items) {
    try {
      const bitmap = await createImageBitmap(item.file, { imageOrientation: "from-image" });
      reference = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      break;
    } catch {
      continue;
    }
  }
  if (unitSelect.value === "pixels" && reference && !numberOf(widthInput) && !numberOf(heightInput)) {
    widthInput.value = String(reference.width);
    heightInput.value = String(reference.height);
    driver = "w";
  }
  syncLinked();
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
    colors: quality >= 95 ? 0 : Math.max(16, Math.round(quality * 2.56)),
    dpi,
    background: document.querySelector('input[name="background"]:checked').value,
    format: formatSelect.value,
  };
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
  item.li.classList.remove("is-error");
}

function addFiles(files) {
  Promise.all(files.map(async (file) => ({ file, kind: await sniff(file) }))).then((sniffed) => {
    const skipped = sniffed.filter((s) => !s.kind).length;
    for (const { file, kind } of sniffed.filter((s) => s.kind)) {
      const li = template.content.firstElementChild.cloneNode(true);
      const item = {
        file,
        kind,
        li,
        status: li.querySelector(".file-size"),
        saving: li.querySelector(".saving"),
        download: li.querySelector("a"),
        url: null,
        output: null,
        spinner: null,
      };
      li.querySelector(".file-name").textContent = file.name;
      li.querySelector("button").addEventListener("click", () => removeItem(item));
      setStatus(item, formatBytes(file.size));
      items.push(item);
      fileList.append(li);
    }
    if (skipped) {
      showMsg("error", `Skipped ${skipped} file${skipped > 1 ? "s" : ""} that ${skipped > 1 ? "aren't" : "isn't a"} JPG, PNG, WebP or HEIC image${skipped > 1 ? "s" : ""}.`);
    } else {
      hideMsg();
    }
    refresh();
    setReference();
  });
}

function removeItem(item) {
  clearItemResult(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  refresh();
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
  if (r.capped) notes.push("scaled down to fit browser limits");
  if (r.dpiSkipped) notes.push("WebP can't store a resolution");
  setStatus(item, notes.join(" · "));
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
  fileList.replaceChildren();
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  busy(false);
  hideMsg();
  refresh();
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
  syncLinked();
});
heightInput.addEventListener("input", () => {
  driver = "h";
  syncLinked();
});
lockBtn.addEventListener("click", () => {
  setLocked(!isLocked());
  syncLinked();
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
