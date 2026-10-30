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
};

let bytes = null;
let password = "";
let url = null;
let currentName = "";

function preset() {
  return document.querySelector('input[name="preset"]:checked').value;
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
    r = await runner.run({ bytes, password, preset: preset() }, [], (p) => showMsg("info", p, true));
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
    const tip = preset() === "small" ? "" : " Try Smallest for stronger compression.";
    showMsg("info", "This PDF is already well optimized. This setting couldn't make it any smaller." + tip);
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
  radio.addEventListener("change", () => {
    presetHint.textContent = HINTS[preset()];
    result.hidden = true;
  });
}
presetHint.textContent = HINTS[preset()];

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
