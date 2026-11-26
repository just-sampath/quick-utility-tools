import { initTheme, formatBytes, downloadName, bindRangeSync } from "../../assets/js/common.js";
import { createFileList } from "../../core/image/file-list.js";
import { sniffImages } from "../../core/image/files.js";
import { DECODE_ERRORS, ANIM_NOTE, CAP_LIMIT, sizeChange } from "../../core/image/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const formatSelect = document.getElementById("formatSelect");
const formatOptionsRow = document.getElementById("formatOptionsRow");
const qualityField = document.getElementById("qualityField");
const qualityRange = document.getElementById("qualityRange");
const qualityInput = document.getElementById("qualityInput");
const backgroundField = document.getElementById("backgroundField");
const formatNote = document.getElementById("formatNote");
const convertBtn = document.getElementById("convertBtn");
const resultTitle = document.getElementById("resultTitle");
const resultFlag = document.getElementById("resultFlag");

const ERRORS = {
  ...DECODE_ERRORS,
  engine: "The conversion engine failed to load. Check your connection and try again.",
  crashed: "Ran out of memory on this image.",
};

const LABELS = { jpeg: "JPG", png: "PNG", webp: "WebP" };
const FORMAT_NOTES = {
  jpeg: "JPG has no transparency, so transparent areas are filled with the background color.",
  png: "PNG is lossless, so every pixel is kept exactly and the file is often larger than a JPG or WebP.",
  webp: "WebP supports transparency and is usually smaller than JPG or PNG.",
};

const list = createFileList({
  action: convertBtn,
  label: (items) => (items.length > 1 ? `Convert ${items.length} images` : "Convert image"),
  zipName: "converted-images.zip",
  worker: "./convert-worker.js",
  needsCanvas: true,
  prepare: sniffImages,
  idleText,
  summarize,
});

const formatLabel = (kind) => LABELS[kind] || kind.toUpperCase();

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
  formatOptionsRow.hidden = qualityField.hidden && backgroundField.hidden;
  formatNote.textContent = FORMAT_NOTES[format];
}

function idleText(item) {
  const parts = [`${formatLabel(item.kind)} · ${formatBytes(item.file.size)}`];
  if (item.animated) parts.push(ANIM_NOTE);
  return parts.join(" · ");
}

function finishItem(item, r, format) {
  if (!r.ok) {
    list.setStatus(item, ERRORS[r.error] || ERRORS.decode, "error");
    return;
  }
  const blob = new Blob([r.bytes], { type: r.type });
  list.setOutput(item, blob, downloadName(item.file.name, "", r.ext), { capped: r.capped });
  const notes = [`${formatLabel(item.kind)} → ${LABELS[format]}`, `${formatBytes(item.file.size)} → ${formatBytes(blob.size)}`, `${r.width}×${r.height}`];
  if (item.animated) notes.push(ANIM_NOTE);
  list.setStatus(item, notes.join(" · "));
  const flags = [];
  if (item.kind === format) flags.push(`This file was already ${LABELS[format]}. It was re-encoded, which can change its size and quality.`);
  if (r.capped) flags.push(`Scaled down to ${r.width}×${r.height} (${CAP_LIMIT}).`);
  list.setFlag(item, flags.join(" "));
  const change = sizeChange(item.file.size, blob.size);
  list.setSaving(item, change.text, !change.smaller);
}

function summarize(done) {
  resultTitle.textContent = done.length > 1 ? `${done.length} images converted` : "Image converted";
  const capped = done.filter((i) => i.output.capped);
  resultFlag.textContent = capped.length
    ? `${capped.length === 1 ? "1 image was" : `${capped.length} images were`} scaled down to ${CAP_LIMIT}: ${capped.map((i) => i.file.name).join(", ")}.`
    : "";
  resultFlag.hidden = !capped.length;
}

convertBtn.addEventListener("click", () => {
  const settings = currentSettings();
  if (settings.error) {
    list.showMsg("error", settings.error);
    return;
  }
  list.runWorkers(settings, (item, r) => finishItem(item, r, settings.format), "Some images couldn't be converted. See the list above.");
});

bindRangeSync(qualityRange, qualityInput);
formatSelect.addEventListener("change", updateFormat);
updateFormat();
