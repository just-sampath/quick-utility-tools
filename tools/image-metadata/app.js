import { initTheme, formatBytes, createStatus, downloadName, bindDropzone } from "../../assets/js/common.js";
import { makeZip } from "../../assets/js/zip.js";
import { readMetadata, stripMetadata } from "./metadata.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const options = document.getElementById("options");
const keepOrientation = document.getElementById("keepOrientation");
const orientationRow = document.getElementById("orientationRow");
const orientationNote = document.getElementById("orientationNote");
const removeIcc = document.getElementById("removeIcc");
const stripBtn = document.getElementById("stripBtn");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const statSaved = document.getElementById("statSaved");
const zipBtn = document.getElementById("zipBtn");
const template = document.getElementById("itemTemplate");
const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));

const REMOVED_NAMES = {
  exif: "EXIF",
  xmp: "XMP",
  iptc: "IPTC",
  comment: "comments",
  text: "text chunks",
  time: "timestamp",
  other: "other data",
  trailing: "trailing data",
  icc: "color profile",
};

const TYPES = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const EXTS = { jpeg: "jpg", png: "png", webp: "webp" };

let items = [];
let zipUrl = null;

function idleText(item) {
  const size = formatBytes(item.file.size);
  if (!item.meta.ok) return item.meta.error;
  const found = item.meta.groups.filter((g) => g.id !== "icc").map((g) => g.label);
  if (found.length) return `${size} · ${found.join(", ")}`;
  return item.meta.hasIcc ? `${size} · No metadata found, only a color profile` : `${size} · No metadata found`;
}

function setStatus(item, text, error = false) {
  item.li.classList.toggle("is-error", error);
  item.status.textContent = text;
}

function renderDetails(item) {
  const box = item.details;
  box.replaceChildren();
  for (const group of item.meta.groups) {
    const section = document.createElement("section");
    section.className = "meta-group";
    const title = document.createElement("h3");
    title.className = "meta-group-title";
    title.textContent = group.label;
    const list = document.createElement("dl");
    list.className = "meta-grid";
    for (const entry of group.entries) {
      const dt = document.createElement("dt");
      dt.textContent = entry.label;
      const dd = document.createElement("dd");
      dd.textContent = entry.value;
      list.append(dt, dd);
    }
    section.append(title, list);
    box.append(section);
  }
}

function toggleDetails(item) {
  const open = item.details.hidden;
  item.details.hidden = !open;
  item.toggle.setAttribute("aria-expanded", String(open));
  item.toggle.textContent = open ? "Hide details" : "Details";
}

function clearItemResult(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = null;
  item.output = null;
  item.saving.hidden = true;
  item.download.hidden = true;
  item.li.classList.remove("is-error");
}

async function addFiles(files) {
  const added = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      bytes = new Uint8Array(0);
    }
    const meta = readMetadata(bytes);
    added.push({ file, meta });
  }
  const bad = added.filter((a) => !a.meta.ok).length;
  for (const { file, meta } of added) {
    const li = template.content.firstElementChild.cloneNode(true);
    const item = {
      file,
      meta,
      li,
      status: li.querySelector(".file-size"),
      saving: li.querySelector(".saving"),
      download: li.querySelector("a"),
      toggle: li.querySelector(".meta-toggle"),
      details: li.querySelector(".meta-details"),
      url: null,
      output: null,
    };
    li.querySelector(".file-name").textContent = file.name;
    li.querySelector(".meta-remove").addEventListener("click", () => removeItem(item));
    item.toggle.addEventListener("click", () => toggleDetails(item));
    if (meta.ok && meta.groups.length) {
      renderDetails(item);
      item.toggle.hidden = false;
    }
    setStatus(item, idleText(item), !meta.ok);
    items.push(item);
    fileList.append(li);
  }
  if (bad) showMsg("error", `${bad} file${bad > 1 ? "s" : ""} couldn't be read. Only valid JPG, PNG and WebP images work. See the list below.`);
  else hideMsg();
  refresh();
}

function removeItem(item) {
  clearItemResult(item);
  item.li.remove();
  items = items.filter((i) => i !== item);
  refresh();
  if (items.some((i) => i.output)) showSummary();
}

function readable() {
  return items.filter((i) => i.meta.ok);
}

function refresh() {
  const has = items.length > 0;
  dz.hidden = has;
  fileList.hidden = !has;
  options.hidden = !has;
  const tilted = readable().some((i) => i.meta.orientation > 1);
  orientationRow.hidden = !tilted;
  orientationNote.hidden = !tilted;
  const n = readable().length;
  stripBtn.textContent = n > 1 ? `Remove metadata from ${n} images` : "Remove metadata";
  stripBtn.disabled = n === 0;
  if (!has) result.hidden = true;
}

function busy(on) {
  stripBtn.disabled = on || readable().length === 0;
  addBtn.disabled = on;
  fileInput.disabled = on;
  for (const item of items) item.li.querySelector(".meta-remove").disabled = on;
}

function removedText(item, removed) {
  const names = removed.map((k) => (k === "exif" && item.meta.groups.some((g) => g.id === "gps") ? "EXIF, GPS" : REMOVED_NAMES[k]));
  return names.join(", ");
}

async function stripAll() {
  hideMsg();
  result.hidden = true;
  busy(true);
  const opts = { keepOrientation: keepOrientation.checked, removeIcc: removeIcc.checked };
  for (const item of readable()) {
    clearItemResult(item);
    let bytes;
    try {
      bytes = new Uint8Array(await item.file.arrayBuffer());
    } catch {
      setStatus(item, "Couldn't read this file.", true);
      continue;
    }
    const r = stripMetadata(bytes, opts);
    if (!r.ok) {
      setStatus(item, r.error, true);
      continue;
    }
    const type = TYPES[item.meta.format];
    const blob = r.changed ? new Blob([r.bytes], { type }) : item.file;
    const original = item.file.name.match(/\.([a-z0-9]+)$/i);
    const ext = original ? original[1].toLowerCase() : EXTS[item.meta.format];
    const name = r.changed ? downloadName(item.file.name, "-clean", ext) : item.file.name;
    item.output = { blob, name, removed: r.changed };
    item.url = URL.createObjectURL(blob);
    item.download.href = item.url;
    item.download.download = name;
    item.download.hidden = false;
    if (r.changed) {
      setStatus(item, `${formatBytes(item.file.size)} → ${formatBytes(blob.size)} · Removed ${removedText(item, r.removed)}`);
      item.saving.textContent = "Cleaned";
      item.saving.classList.remove("is-none");
    } else {
      setStatus(item, `${formatBytes(item.file.size)} · ${item.meta.hasIcc && !item.meta.groups.some((g) => g.id !== "icc") ? "Nothing to remove, the color profile was kept" : "No metadata found"}`);
      item.saving.textContent = "No metadata found";
      item.saving.classList.add("is-none");
    }
    item.saving.hidden = false;
  }
  busy(false);
  showSummary();
  if (readable().some((i) => !i.output)) showMsg("error", "Some images couldn't be processed. See the list above.");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showSummary() {
  const done = items.filter((i) => i.output);
  if (!done.length) {
    result.hidden = true;
    return;
  }
  const before = done.reduce((n, i) => n + i.file.size, 0);
  const after = done.reduce((n, i) => n + i.output.blob.size, 0);
  const cleaned = done.filter((i) => i.output.removed).length;
  resultTitle.textContent = cleaned ? `${cleaned} image${cleaned > 1 ? "s" : ""} cleaned` : "No metadata found";
  statBefore.textContent = formatBytes(before);
  statAfter.textContent = formatBytes(after);
  statSaved.textContent = after < before ? formatBytes(before - after) : "nothing";
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  zipBtn.href = "#";
  zipBtn.hidden = done.length < 2;
  result.hidden = false;
}

function clearAll() {
  for (const item of items) clearItemResult(item);
  items = [];
  fileList.replaceChildren();
  if (zipUrl) URL.revokeObjectURL(zipUrl);
  zipUrl = null;
  busy(false);
  hideMsg();
  refresh();
}

bindDropzone(dz, fileInput, addFiles);
options.addEventListener("dragover", (e) => e.preventDefault());
options.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!stripBtn.disabled && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
});

stripBtn.addEventListener("click", stripAll);
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
    zipBtn.download = "clean-images.zip";
    zipBtn.textContent = "Download all as ZIP";
    zipBtn.click();
  }).catch(() => {
    zipBtn.textContent = "Download all as ZIP";
    showMsg("error", "Couldn't prepare the ZIP. Download the images one by one instead.");
  });
});
