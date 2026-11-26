import { initTheme, bindRangeSync } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";
import { damaged } from "../../core/pdf/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const options = document.getElementById("options");
const presetHint = document.getElementById("presetHint");
const imageFields = document.getElementById("imageFields");
const unitSelect = document.getElementById("unitSelect");
const sizeInput = document.getElementById("sizeInput");
const sizeUnit = document.getElementById("sizeUnit");
const sizeLabel = document.getElementById("sizeLabel");
const qualityRange = document.getElementById("qualityRange");
const qualityInput = document.getElementById("qualityInput");
const compressBtn = document.getElementById("compressBtn");
const statSaved = document.getElementById("statSaved");
const statImagesWrap = document.getElementById("statImagesWrap");
const statImages = document.getElementById("statImages");

const HINTS = {
  lossless: "Cleans up the file structure only. Images aren't changed.",
  balanced: "Recompresses images and caps large ones at 2000 px.",
  small: "Stronger compression and caps large images at 1300 px.",
  custom: "Set your own image size and quality below.",
};

const VALUES = {
  balanced: { unit: "pixels", size: 2000, quality: 75 },
  small: { unit: "pixels", size: 1300, quality: 55 },
};

const tool = createPdfFileTool({
  worker: "./compress-worker.js",
  password: {
    form: document.getElementById("passwordBlock"),
    input: document.getElementById("passwordInput"),
    button: document.getElementById("unlockBtn"),
  },
  onFile: () => {
    options.hidden = false;
  },
  onUnlock: compress,
  onReset: () => {
    options.hidden = true;
  },
  onBusy: (on) => {
    compressBtn.disabled = on;
  },
});

function preset() {
  return document.querySelector('input[name="preset"]:checked').value;
}

function clamp(input, min, max, fallback) {
  const n = Math.round(Number(input.value));
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback;
}

function settings() {
  const unit = unitSelect.value;
  return {
    unit,
    size: unit === "percent" ? clamp(sizeInput, 1, 100, 100) : clamp(sizeInput, 1, 100000, 2000),
    quality: clamp(qualityInput, 1, 100, 75),
  };
}

function syncUnit() {
  const pixels = unitSelect.value === "pixels";
  sizeUnit.textContent = pixels ? "px" : "%";
  sizeLabel.textContent = pixels ? "Longest side" : "Scale";
  sizeInput.max = pixels ? "100000" : "100";
}

function syncPreset() {
  const p = preset();
  const lossless = p === "lossless";
  if (VALUES[p]) {
    unitSelect.value = VALUES[p].unit;
    syncUnit();
    sizeInput.value = VALUES[p].size;
    qualityInput.value = VALUES[p].quality;
    qualityRange.value = VALUES[p].quality;
  }
  imageFields.hidden = lossless;
  for (const el of [unitSelect, sizeInput, qualityInput, qualityRange]) el.disabled = lossless;
  presetHint.textContent = HINTS[p];
  tool.clearResult();
}

function markCustom() {
  document.querySelector('input[name="preset"][value="custom"]').checked = true;
  presetHint.textContent = HINTS.custom;
  tool.clearResult();
}

async function compress() {
  tool.clearResult();
  const r = await tool.run({ preset: preset(), ...settings() }, "Loading the PDF engine…");
  if (!r) return;
  if (r.ok) finish(r.bytes, r.resized);
  else tool.fail(r, damaged("processed"));
}

function finish(outBytes, resized) {
  const before = tool.size;
  if (outBytes.byteLength > before * 0.99) {
    tool.showMsg("info", preset() === "lossless"
      ? "This PDF is already well optimized. Lossless cleanup couldn't make it any smaller. Try Balanced or Smallest."
      : "This PDF is already well optimized. These settings couldn't make it any smaller. Try a lower quality or a smaller size.");
    return;
  }
  statSaved.textContent = Math.min(99, Math.round((1 - outBytes.byteLength / before) * 100)) + "%";
  statImages.textContent = resized;
  statImagesWrap.hidden = !resized;
  tool.showResult(outBytes, "_compressed");
}

for (const radio of document.querySelectorAll('input[name="preset"]')) {
  radio.addEventListener("change", syncPreset);
}
unitSelect.addEventListener("change", () => {
  syncUnit();
  sizeInput.value = unitSelect.value === "percent" ? 50 : 1600;
  markCustom();
});
sizeInput.addEventListener("input", markCustom);
bindRangeSync(qualityRange, qualityInput, markCustom);
syncPreset();

compressBtn.addEventListener("click", compress);
