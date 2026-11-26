import { initTheme, formatBytes, createJobRunner, createStatus, downloadName, bindDropzone } from "../../assets/js/common.js";
import { bindZipButton } from "../../assets/js/zip.js";
import { sniffFile } from "../../assets/js/codecs.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const options = document.getElementById("options");
const formatSelect = document.getElementById("formatSelect");
const qualityField = document.getElementById("qualityField");
const qualityInput = document.getElementById("qualityInput");
const backgroundField = document.getElementById("backgroundField");
const formatNote = document.getElementById("formatNote");
const convertBtn = document.getElementById("convertBtn");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const resultFlag = document.getElementById("resultFlag");
const zipBtn = document.getElementById("zipBtn");
const template = document.getElementById("itemTemplate");

const runner = createJobRunner("./convert-worker.js", "module");
const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));

const ERRORS = {
  decode: "Couldn't read this image.",
  avif: "This browser can't open AVIF images.",
  heic: "Couldn't read this HEIC image.",
  engine: "The conversion engine failed to load. Check your connection and try again.",
  crashed: "Ran out of memory on this image.",
};

const LABELS = { jpeg: "JPG", png: "PNG", webp: "WebP" };
const FORMAT_NOTES = {
  jpeg: "JPG has no transparency, so transparent areas are filled with the background color.",
  png: "PNG is lossless, so every pixel is kept exactly and the file is often larger than a JPG or WebP.",
  webp: "WebP supports transparency and is usually smaller than JPG or PNG.",
};
const ANIM_NOTE = "animated, only the first frame is kept";

let items = [];
let batch = 0;

const zip = bindZipButton(
  zipBtn,
  "converted-images.zip",
  () => items.filter((i) => i.output).map((i) => i.output),
  () => showMsg("error", "Couldn't prepare the ZIP. Download the images one by one instead."),
);

function currentSettings() {
  const quality = Number(qualityInput.value.trim() === "" ? 0 : qualityInput.value);
  const format = formatSelect.value;
  if (format !== "png" && (!Number.isInteger(quality) || quality < 1 || quality > 100)) {
    return { error: "Quality must be a whole number from 1 to 100." };
  }
  return { format, quality, background: document.querySelector('input[name="background"]:checked').value };
}

function updateFormat() {
  const format = formatSelect.value;
  qualityField.hidden = format === "png";
  backgroundField.hidden = format !== "jpeg";
  formatNote.textContent = FORMAT_NOTES[format];
}

function idleText(item) {
  const parts = [`${LABELS[item.kind] || item.kind.toUpperCase()} · ${formatBytes(item.file.size)}`];
  if (item.animated) parts.push(ANIM_NOTE);
  return parts.join(" · ");
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
  item.capped = false;
  item.saving.hidden = true;
  item.download.hidden = true;
  item.flag.hidden = true;
  item.li.classList.remove("is-error");
}

function addFiles(files) {
  Promise.all(files.map(async (file) => ({ file, ...(await sniffFile(file)) }))).then((sniffed) => {
    const accepted = sniffed.filter((s) => s.kind && s.kind !== "gif");
    const skipped = sniffed.length - accepted.length;
    const gifs = sniffed.filter((s) => s.kind === "gif").length;
    for (const { file, kind, animated } of accepted) {
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
        url: null,
        output: null,
        spinner: null,
        capped: false,
      };
      li.querySelector(".file-name").textContent = file.name;
      li.querySelector("button").addEventListener("click", () => removeItem(item));
      setStatus(item, idleText(item));
      items.push(item);
      fileList.append(li);
    }
    if (skipped) {
      const gifNote = gifs ? " GIF images aren't supported, because only the first frame would be kept." : "";
      showMsg("error", `Skipped ${skipped} file${skipped > 1 ? "s" : ""} that ${skipped > 1 ? "aren't" : "isn't a"} JPG, PNG, WebP, HEIC or AVIF image${skipped > 1 ? "s" : ""}.${gifNote}`);
    } else {
      hideMsg();
    }
    refresh();
  });
}

function removeItem(item) {
  clearItemResult(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  refresh();
  if (items.some((i) => i.output)) showSummary();
}

function refresh() {
  const has = items.length > 0;
  dz.hidden = has;
  fileList.hidden = !has;
  options.hidden = !has;
  convertBtn.textContent = items.length > 1 ? `Convert ${items.length} Images` : "Convert Image";
  if (!has) result.hidden = true;
}

function busy(on) {
  convertBtn.disabled = on;
  addBtn.disabled = on;
  fileInput.disabled = on;
  for (const item of items) item.li.querySelector("button").disabled = on;
}

function finishItem(item, r, format) {
  item.spinner?.remove();
  item.spinner = null;
  if (!r.ok) {
    setStatus(item, ERRORS[r.error] || ERRORS.decode, "error");
    return;
  }
  const blob = new Blob([r.bytes], { type: r.type });
  const name = downloadName(item.file.name, "", r.ext);
  item.output = { blob, name };
  item.url = URL.createObjectURL(blob);
  item.download.href = item.url;
  item.download.download = name;
  item.download.hidden = false;
  const notes = [`${LABELS[item.kind]} → ${LABELS[format]}`, `${formatBytes(item.file.size)} → ${formatBytes(blob.size)}`, `${r.width}×${r.height}`];
  if (item.animated) notes.push(ANIM_NOTE);
  setStatus(item, notes.join(" · "));
  const flags = [];
  if (item.kind === format) flags.push(`This file was already ${LABELS[format]}. It was re-encoded, which can change its size and quality.`);
  if (r.capped) {
    item.capped = true;
    flags.push(`Scaled down to ${r.width}×${r.height} (about 16.7 megapixels, the browser limit).`);
  }
  item.flag.textContent = flags.join(" ");
  item.flag.hidden = !flags.length;
  const pct = Math.round((1 - blob.size / item.file.size) * 100);
  item.saving.textContent = pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : "Same size";
  item.saving.classList.toggle("is-none", pct <= 0);
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
  resultTitle.textContent = done.length > 1 ? `${done.length} images converted` : "Image converted";
  statBefore.textContent = formatBytes(before);
  statAfter.textContent = formatBytes(after);
  const capped = done.filter((i) => i.capped);
  resultFlag.textContent = capped.length
    ? `${capped.length === 1 ? "1 image was" : `${capped.length} images were`} scaled down to about 16.7 megapixels, the browser limit: ${capped.map((i) => i.file.name).join(", ")}.`
    : "";
  resultFlag.hidden = !capped.length;
  zip.reset();
  zipBtn.hidden = done.length < 2;
  result.hidden = false;
}

async function convertAll() {
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
    finishItem(item, r, settings.format);
  }
  busy(false);
  showSummary();
  if (items.some((i) => !i.output)) showMsg("error", "Some images couldn't be converted. See the list above.");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearAll() {
  batch++;
  runner.cancel();
  for (const item of items) clearItemResult(item);
  items = [];
  fileList.replaceChildren();
  zip.reset();
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
  if (!convertBtn.disabled && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});

formatSelect.addEventListener("change", updateFormat);
updateFormat();
convertBtn.addEventListener("click", convertAll);
addBtn.addEventListener("click", () => fileInput.click());
clearBtn.addEventListener("click", clearAll);
