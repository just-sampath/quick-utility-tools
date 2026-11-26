import { initTheme, formatBytes, downloadName, bindRangeSync } from "../../assets/js/common.js";
import { createFileList } from "../../core/image/file-list.js";
import { sniffImages } from "../../core/image/files.js";
import { DECODE_ERRORS, ANIM_NOTE, CAP_LIMIT, sizeChange } from "../../core/image/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const qualityInput = document.getElementById("qualityInput");
const qualityRange = document.getElementById("qualityRange");
const unitSelect = document.getElementById("unitSelect");
const widthInput = document.getElementById("widthInput");
const heightInput = document.getElementById("heightInput");
const widthUnit = document.getElementById("widthUnit");
const heightUnit = document.getElementById("heightUnit");
const lockBtn = document.getElementById("lockBtn");
const dpiInput = document.getElementById("dpiInput");
const dpiField = document.getElementById("dpiField");
const bgField = document.getElementById("bgField");
const extraRow = document.getElementById("extraRow");
const formatSelect = document.getElementById("formatSelect");
const compressBtn = document.getElementById("compressBtn");
const resultTitle = document.getElementById("resultTitle");
const statSaved = document.getElementById("statSaved");
const sizeNote = document.getElementById("sizeNote");
const dpiNote = document.getElementById("dpiNote");
const resultFlag = document.getElementById("resultFlag");

const ERRORS = {
  ...DECODE_ERRORS,
  engine: "The compression engine failed to load. Check your connection and try again.",
  crashed: "Ran out of memory on this image. Try a smaller size.",
};

let reference = null;
let mixed = false;
let autoFilled = false;
let refToken = 0;
let driver = "w";

function outputFormatFor(kind, format) {
  if (format !== "same") return format;
  return kind === "jpeg" || kind === "png" || kind === "webp" ? kind : "jpeg";
}

function isResizing(items) {
  const w = numberOf(widthInput);
  const h = numberOf(heightInput);
  if (unitSelect.value === "percent") {
    return (w > 0 && w !== 100) || (h > 0 && h !== 100);
  }
  if (!w && !h) return false;
  const known = items.filter((i) => i.dims);
  if (!known.length) return true;
  const locked = isLocked();
  return known.some(({ dims: d }) => {
    let fx = w ? w / d.width : null;
    let fy = h ? h / d.height : null;
    if (locked) {
      const f = (driver === "w" ? fx : fy) ?? fx ?? fy;
      fx = fy = f;
    }
    const tw = Math.max(1, Math.round(d.width * (fx ?? fy ?? 1)));
    const th = Math.max(1, Math.round(d.height * (fy ?? fx ?? 1)));
    return tw !== d.width || th !== d.height;
  });
}

function actionLabel(items) {
  const verb = isResizing(items) ? "Compress & resize" : "Compress";
  return items.length > 1 ? `${verb} ${items.length} images` : `${verb} image`;
}

function updateActionLabel() {
  compressBtn.textContent = actionLabel(list.items);
}

const list = createFileList({
  action: compressBtn,
  label: actionLabel,
  zipName: "compressed-images.zip",
  worker: "./compress-worker.js",
  needsCanvas: true,
  prepare: sniffImages,
  idleText,
  summarize,
  onChange: () => {
    updateFormatFields();
    setReference();
  },
  onClear: () => {
    refToken++;
    if (autoFilled) widthInput.value = heightInput.value = "";
    reference = null;
    mixed = false;
    autoFilled = false;
  },
});

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
  updateActionLabel();
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

function updateFormatFields() {
  const fmt = formatSelect.value;
  const items = list.items;
  const canStoreDpi = fmt !== "webp" && (items.length === 0 || items.some((i) => outputFormatFor(i.kind, fmt) !== "webp"));
  const needsBg = items.some((i) => i.kind !== "jpeg" && outputFormatFor(i.kind, fmt) === "jpeg");
  dpiField.hidden = !canStoreDpi;
  bgField.hidden = !needsBg;
  extraRow.hidden = dpiField.hidden && bgField.hidden;
  updateDpiNote();
}

function updateDpiNote() {
  if (dpiField.hidden) {
    dpiNote.textContent = "";
    dpiNote.hidden = true;
    return;
  }
  const items = list.items;
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
  for (const item of [...list.items]) {
    if (item.dims !== undefined) continue;
    const dims = await readDims(item.file);
    if (token !== refToken) return;
    item.dims = dims;
  }
  const known = list.items.filter((i) => i.dims).map((i) => i.dims);
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
  updateActionLabel();
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
  const dpi = dpiField.hidden ? 0 : numberOf(dpiInput);
  const max = unit === "percent" ? 1000 : 16384;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0 || w > max || h > max) {
    return { error: `Enter whole numbers for width and height, up to ${max}${unit === "percent" ? "%" : " px"}.` };
  }
  if (unit === "pixels" && !w && !h) return { error: "Enter a width or a height in pixels." };
  if (unit === "percent" && (!w || !h)) return { error: "Enter a width and height percentage." };
  const quality = numberOf(qualityInput);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) return { error: "Quality must be a whole number from 1 to 100." };
  if (!dpiField.hidden && dpiInput.value.trim() !== "" && (!Number.isInteger(dpi) || dpi < 1 || dpi > 2400)) {
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

function idleText(item) {
  return item.animated ? `${formatBytes(item.file.size)} · ${ANIM_NOTE}` : formatBytes(item.file.size);
}

function finishItem(item, r) {
  if (!r.ok) {
    list.setStatus(item, ERRORS[r.error] || ERRORS.decode, "error");
    return;
  }
  const blob = new Blob([r.bytes], { type: r.type });
  list.setOutput(item, blob, r.kept ? item.file.name : downloadName(item.file.name, "_compressed", r.ext), { capped: r.capped });
  const notes = [`${formatBytes(item.file.size)} → ${formatBytes(blob.size)}`, `${r.width}×${r.height}`];
  if (item.animated && !r.kept) notes.push(ANIM_NOTE);
  if (r.dpiSkipped) notes.push("WebP can't store a resolution");
  list.setStatus(item, notes.join(" · "));
  if (r.capped) list.setFlag(item, `Scaled down to ${r.width}×${r.height} (${CAP_LIMIT}). The result is smaller than the size you asked for.`);
  const change = sizeChange(item.file.size, blob.size);
  list.setSaving(item, r.kept ? "Already optimized" : change.text, r.kept || !change.smaller);
}

function summarize(done, before, after) {
  resultTitle.textContent = done.length > 1 ? `${done.length} images ready` : "Image ready";
  statSaved.textContent = after < before ? `${formatBytes(before - after)} (${Math.min(99, Math.round((1 - after / before) * 100))}%)` : "nothing";
  const capped = done.filter((i) => i.output.capped);
  resultFlag.textContent = capped.length
    ? `${capped.length === 1 ? "1 image was" : `${capped.length} images were`} scaled down to ${CAP_LIMIT}, so ${capped.length === 1 ? "it is" : "they are"} smaller than the size you asked for: ${capped.map((i) => i.file.name).join(", ")}.`
    : "";
  resultFlag.hidden = !capped.length;
}

bindRangeSync(qualityRange, qualityInput);
formatSelect.addEventListener("change", updateFormatFields);
unitSelect.addEventListener("change", changeUnit);
widthInput.addEventListener("input", () => {
  driver = "w";
  autoFilled = false;
  syncLinked();
  updateSizeNote();
  updateActionLabel();
});
heightInput.addEventListener("input", () => {
  driver = "h";
  autoFilled = false;
  syncLinked();
  updateSizeNote();
  updateActionLabel();
});
lockBtn.addEventListener("click", () => {
  setLocked(!isLocked());
  syncLinked();
  updateSizeNote();
  updateActionLabel();
});

compressBtn.addEventListener("click", () => {
  const settings = currentSettings();
  if (settings.error) {
    list.showMsg("error", settings.error);
    return;
  }
  list.runWorkers(settings, finishItem, "Some images couldn't be processed. See the list above.");
});

updateFormatFields();
