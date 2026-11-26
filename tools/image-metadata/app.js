import { initTheme, formatBytes, downloadName } from "../../assets/js/common.js";
import { createFileList } from "../../core/image/file-list.js";
import { readMetadata, stripMetadata } from "./metadata.js";

initTheme(document.querySelector(".theme-toggle"));

const keepOrientation = document.getElementById("keepOrientation");
const orientationRow = document.getElementById("orientationRow");
const orientationNote = document.getElementById("orientationNote");
const removeIcc = document.getElementById("removeIcc");
const stripBtn = document.getElementById("stripBtn");
const resultTitle = document.getElementById("resultTitle");
const statSaved = document.getElementById("statSaved");

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

const readable = (items) => items.filter((i) => i.meta.ok);

const list = createFileList({
  action: stripBtn,
  label: (items) => {
    const n = readable(items).length;
    return n > 1 ? `Remove metadata from ${n} images` : "Remove metadata";
  },
  zipName: "clean-images.zip",
  prepare,
  idleText,
  canRun: (items) => readable(items).length > 0,
  isError: (item) => !item.meta.ok,
  setup,
  summarize,
  onChange: () => {
    const tilted = readable(list.items).some((i) => i.origMeta.orientation > 1);
    orientationRow.hidden = !tilted;
    orientationNote.hidden = !tilted;
  },
});

async function prepare(files) {
  const entries = [];
  for (const file of files) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      bytes = new Uint8Array(0);
    }
    const meta = readMetadata(bytes);
    entries.push({ file, meta, origMeta: meta, hasData: meta.ok && meta.groups.length > 0, cleaned: false });
  }
  const bad = entries.filter((e) => !e.meta.ok).length;
  const message = bad ? `${bad} file${bad > 1 ? "s" : ""} couldn't be read. Only valid JPG, PNG and WebP images work. See the list below.` : "";
  return { entries, message };
}

function idleText(item) {
  const size = formatBytes(item.file.size);
  if (!item.meta.ok) return item.meta.error;
  const found = item.meta.groups.filter((g) => g.id !== "icc").map((g) => g.label);
  if (found.length) return `${size} · ${found.join(", ")}`;
  return item.meta.hasIcc ? `${size} · No metadata found, only a color profile` : `${size} · No metadata found`;
}

function setup(item) {
  item.toggle = item.li.querySelector(".meta-toggle");
  item.details = item.li.querySelector(".meta-details");
  item.toggle.addEventListener("click", () => toggleDetails(item));
  if (item.hasData) {
    renderDetails(item);
    item.toggle.hidden = false;
  }
}

function isOrientationOnly(group) {
  return group.id === "exif" && group.entries.length === 1 && group.entries[0].label === "Orientation";
}

function renderDetails(item) {
  const box = item.details;
  box.replaceChildren();
  if (!item.meta.groups.length) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "No metadata remains in this file.";
    box.append(note);
    return;
  }
  if (item.cleaned) {
    const note = document.createElement("p");
    note.className = "hint";
    const onlyOrientation = item.meta.groups.length === 1 && isOrientationOnly(item.meta.groups[0]);
    note.textContent = onlyOrientation
      ? "All camera, date, and GPS metadata was removed. Only orientation was kept so this photo displays upright."
      : "Cleaned output — only the kept items below remain in this file.";
    box.append(note);
  }
  for (const group of item.meta.groups) {
    const section = document.createElement("section");
    section.className = "meta-group";
    const title = document.createElement("h3");
    title.className = "meta-group-title";
    title.textContent = item.cleaned && isOrientationOnly(group) ? "Kept orientation" : group.label;
    const grid = document.createElement("dl");
    grid.className = "meta-grid";
    for (const entry of group.entries) {
      const dt = document.createElement("dt");
      dt.textContent = entry.label;
      const dd = document.createElement("dd");
      dd.textContent = entry.value;
      grid.append(dt, dd);
    }
    section.append(title, grid);
    box.append(section);
  }
}

function toggleDetails(item) {
  const open = item.details.hidden;
  item.details.hidden = !open;
  item.toggle.setAttribute("aria-expanded", String(open));
  item.toggle.textContent = open ? "Hide details" : "Details";
}

function removedText(meta, removed) {
  const names = removed.map((k) => (k === "exif" && meta.groups.some((g) => g.id === "gps") ? "EXIF, GPS" : REMOVED_NAMES[k]));
  return names.join(", ");
}

async function strip(item, opts) {
  let bytes;
  try {
    bytes = new Uint8Array(await item.file.arrayBuffer());
  } catch {
    list.setStatus(item, "Couldn't read this file.", "error");
    return;
  }
  const r = stripMetadata(bytes, opts);
  if (!r.ok) {
    list.setStatus(item, r.error, "error");
    return;
  }
  const format = item.origMeta.format;
  const removedSummary = r.changed ? removedText(item.origMeta, r.removed) : "";
  const cleanMeta = readMetadata(r.bytes);
  if (cleanMeta.ok) item.meta = cleanMeta;
  item.hasData = item.meta.ok && item.meta.groups.length > 0;
  item.cleaned = r.changed;
  renderDetails(item);
  if (item.hasData) {
    item.toggle.hidden = false;
  } else if (item.details.hidden) {
    item.toggle.hidden = true;
  }
  const blob = r.changed ? new Blob([r.bytes], { type: TYPES[format] }) : item.file;
  const original = item.file.name.match(/\.([a-z0-9]+)$/i);
  const ext = original ? original[1].toLowerCase() : EXTS[format];
  const name = r.changed ? downloadName(item.file.name, "_clean", ext) : item.file.name;
  list.setOutput(item, blob, name, { removed: r.changed });
  if (r.changed) {
    list.setStatus(item, `${formatBytes(item.file.size)} → ${formatBytes(blob.size)} · Removed ${removedSummary}`);
    list.setSaving(item, "Cleaned", false);
  } else {
    const onlyIcc = item.meta.hasIcc && !item.meta.groups.some((g) => g.id !== "icc");
    list.setStatus(item, `${formatBytes(item.file.size)} · ${onlyIcc ? "Nothing to remove, the color profile was kept" : "No metadata found"}`);
    list.setSaving(item, "No metadata found", true);
  }
}

function summarize(done, before, after) {
  const cleaned = done.filter((i) => i.output.removed).length;
  resultTitle.textContent = cleaned ? `${cleaned} image${cleaned > 1 ? "s" : ""} cleaned` : "No metadata found";
  statSaved.textContent = after < before ? formatBytes(before - after) : "nothing";
}

stripBtn.addEventListener("click", () => {
  const opts = { keepOrientation: keepOrientation.checked, removeIcc: removeIcc.checked };
  list.runEach(readable(list.items), (item) => strip(item, opts), "Some images couldn't be processed. See the list above.");
});
