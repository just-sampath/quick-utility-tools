import {
  initTheme,
  formatBytes,
  createJobRunner,
  createStatus,
  downloadName,
  bindDropzone,
  looksLikePdf,
} from "../../assets/js/common.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileRow = document.getElementById("fileRow");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const clearBtn = document.getElementById("clearBtn");
const options = document.getElementById("options");
const presetHint = document.getElementById("presetHint");
const unitSelect = document.getElementById("unitSelect");
const sizeInput = document.getElementById("sizeInput");
const sizeUnit = document.getElementById("sizeUnit");
const sizeLabel = document.getElementById("sizeLabel");
const qualityInput = document.getElementById("qualityInput");
const customHint = document.getElementById("customHint");
const compressBtn = document.getElementById("compressBtn");
const pwBlock = document.getElementById("passwordBlock");
const pwInput = document.getElementById("passwordInput");
const unlockBtn = document.getElementById("unlockBtn");
const result = document.getElementById("result");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const statSaved = document.getElementById("statSaved");
const statImagesWrap = document.getElementById("statImagesWrap");
const statImages = document.getElementById("statImages");
const downloadBtn = document.getElementById("downloadBtn");
const anotherBtn = document.getElementById("anotherBtn");

const runner = createJobRunner("./compress-worker.js");
const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));

const HINTS = {
  lossless: "Only cleans up the file structure. Images and quality are untouched, so savings are usually small.",
  balanced: "Recompresses images and shrinks very large ones to about 2000 px. Good for sharing and printing.",
  small: "Stronger image compression, large images shrunk to about 1300 px. Best for email and on-screen reading.",
  custom: "Set your own image quality and size below.",
};

const VALUES = {
  balanced: { unit: "pixels", size: 2000, quality: 75 },
  small: { unit: "pixels", size: 1300, quality: 55 },
};

let bytes = null;
let password = "";
let url = null;
let currentName = "";

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
  }
  for (const el of [unitSelect, sizeInput, qualityInput]) el.disabled = lossless;
  customHint.hidden = lossless;
  presetHint.textContent = HINTS[p];
  result.hidden = true;
}

function markCustom() {
  document.querySelector('input[name="preset"][value="custom"]').checked = true;
  presetHint.textContent = HINTS.custom;
  result.hidden = true;
}

function busy(on) {
  compressBtn.disabled = on;
  unlockBtn.disabled = on;
  fileInput.disabled = on;
}

async function compress() {
  busy(true);
  result.hidden = true;
  showMsg("info", "Loading the PDF engine…", true);
  let r;
  try {
    r = await runner.run({ bytes, password, preset: preset(), ...settings() }, [], (p) => showMsg("info", p, true));
  } catch {
    busy(false);
    showMsg("error", "The PDF engine ran out of memory or crashed. Reload the page and try again.");
    return;
  }
  busy(false);
  if (r.ok) {
    finish(r.bytes, r.resized);
  } else if (r.fatal) {
    showMsg("error", "Failed to load the PDF engine. Check your connection and reload the page.");
  } else if (r.needsPassword) {
    hideMsg();
    pwBlock.hidden = false;
    pwInput.focus();
  } else if (r.wrongPassword) {
    password = "";
    showMsg("error", "Incorrect password. Double-check and try again.");
    pwInput.focus();
    pwInput.select();
  } else {
    showMsg("error", "This PDF couldn't be processed. It may be damaged.");
  }
}

function finish(outBytes, resized) {
  pwBlock.hidden = true;
  if (outBytes.byteLength > bytes.byteLength * 0.99) {
    showMsg("info", preset() === "lossless"
      ? "This PDF is already well optimized. Lossless cleanup couldn't make it any smaller. Try Balanced or Smallest."
      : "This PDF is already well optimized. These settings couldn't make it any smaller. Try a lower quality or a smaller size.");
    return;
  }
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(new Blob([outBytes], { type: "application/pdf" }));
  downloadBtn.href = url;
  downloadBtn.download = downloadName(currentName, "_compressed", "pdf");
  statBefore.textContent = formatBytes(bytes.byteLength);
  statAfter.textContent = formatBytes(outBytes.byteLength);
  statSaved.textContent = Math.min(99, Math.round((1 - outBytes.byteLength / bytes.byteLength) * 100)) + "%";
  statImages.textContent = resized;
  statImagesWrap.hidden = !resized;
  hideMsg();
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function pickFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    resetFile();
    showMsg("error", "That doesn't look like a PDF. Please choose a .pdf file.");
    return;
  }
  file.arrayBuffer().then((buf) => {
    resetFile();
    if (!looksLikePdf(buf)) {
      showMsg("error", "This file doesn't contain valid PDF data.");
      return;
    }
    bytes = buf;
    currentName = file.name;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    dz.hidden = true;
    fileRow.hidden = false;
    options.hidden = false;
  });
}

function resetFile() {
  runner.cancel();
  busy(false);
  bytes = null;
  password = "";
  currentName = "";
  hideMsg();
  pwInput.value = "";
  pwBlock.hidden = true;
  options.hidden = true;
  result.hidden = true;
  if (url) {
    URL.revokeObjectURL(url);
    url = null;
  }
}

bindDropzone(dz, fileInput, (files) => pickFile(files[0]));

for (const radio of document.querySelectorAll('input[name="preset"]')) {
  radio.addEventListener("change", syncPreset);
}
unitSelect.addEventListener("change", () => {
  syncUnit();
  sizeInput.value = unitSelect.value === "percent" ? 50 : 1600;
  markCustom();
});
sizeInput.addEventListener("input", markCustom);
qualityInput.addEventListener("input", markCustom);
syncPreset();

compressBtn.addEventListener("click", compress);

clearBtn.addEventListener("click", () => {
  resetFile();
  fileRow.hidden = true;
  dz.hidden = false;
});

pwBlock.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!pwInput.value || !bytes) return;
  password = pwInput.value;
  compress();
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
