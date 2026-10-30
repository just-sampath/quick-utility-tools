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
const pwBlock = document.getElementById("passwordBlock");
const pwInput = document.getElementById("passwordInput");
const unlockBtn = document.getElementById("unlockBtn");
const msg = document.getElementById("msg");
const result = document.getElementById("result");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const downloadBtn = document.getElementById("downloadBtn");
const anotherBtn = document.getElementById("anotherBtn");

const runner = createJobRunner("./decrypt-worker.js");
const { showMsg, hideMsg } = createStatus(msg);

let bytes = null;
let url = null;
let currentName = "";

async function decrypt(password) {
  busy(true);
  showMsg("info", password ? "Unlocking…" : "Checking your PDF…", true);
  let r;
  try {
    r = await runner.run({ bytes, password });
  } catch {
    busy(false);
    showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    return;
  }
  busy(false);
  if (r.ok) {
    finish(r.bytes);
    return;
  }
  if (r.fatal) {
    showMsg("error", "Failed to load the PDF engine. Check your connection and reload the page.");
    return;
  }
  if (r.needsPassword) {
    showPasswordForm();
  } else {
    showMsg("error", "Incorrect password, or the file is damaged. Double-check and try again.");
    pwInput.focus();
    pwInput.select();
  }
}

function finish(outBytes) {
  if (url) URL.revokeObjectURL(url);
  const blob = new Blob([outBytes], { type: "application/pdf" });
  url = URL.createObjectURL(blob);
  downloadBtn.href = url;
  downloadBtn.download = downloadName(currentName, "_decrypted", "pdf");
  statBefore.textContent = formatBytes(bytes.byteLength);
  statAfter.textContent = formatBytes(outBytes.byteLength);
  hideMsg();
  pwBlock.hidden = true;
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showPasswordForm() {
  hideMsg();
  pwBlock.hidden = false;
  pwInput.focus();
}

function busy(on) {
  unlockBtn.disabled = on;
  fileInput.disabled = on;
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
    bytes = buf;
    currentName = file.name;
    if (!looksLikePdf(buf)) {
      bytes = null;
      showMsg("error", "This file doesn't contain valid PDF data.");
      return;
    }
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    dz.hidden = true;
    fileRow.hidden = false;
    decrypt("");
  });
}

function resetFile() {
  runner.cancel();
  busy(false);
  bytes = null;
  currentName = "";
  hideMsg();
  pwInput.value = "";
  pwBlock.hidden = true;
  result.hidden = true;
  if (url) {
    URL.revokeObjectURL(url);
    url = null;
  }
}

bindDropzone(dz, fileInput, (files) => pickFile(files[0]));

clearBtn.addEventListener("click", () => {
  resetFile();
  fileRow.hidden = true;
  dz.hidden = false;
});

pwBlock.addEventListener("submit", (e) => {
  e.preventDefault();
  const pw = pwInput.value;
  if (!pw || !bytes) return;
  decrypt(pw);
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
