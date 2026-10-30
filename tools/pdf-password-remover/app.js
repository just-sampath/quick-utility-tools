import { initTheme, formatBytes } from "../../assets/js/common.js";

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

let worker = null;
let jobId = 0;
let bytes = null;
let url = null;
let currentName = "";

const ICONS = {
  spinner: '<span class="spinner" aria-hidden="true"></span>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>',
  info: "",
};

function showMsg(kind, text, withSpinner = false) {
  msg.className = "msg msg-" + kind;
  msg.innerHTML = (withSpinner ? ICONS.spinner : ICONS[kind] || "") + "<span></span>";
  msg.lastElementChild.textContent = text;
  msg.hidden = false;
}

function hideMsg() {
  msg.hidden = true;
  msg.innerHTML = "";
}

function getWorker() {
  if (!worker) {
    worker = new Worker("./decrypt-worker.js");
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => {
      busy(false);
      showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    };
  }
  return worker;
}

function decrypt(password) {
  busy(true);
  showMsg("info", password ? "Unlocking…" : "Checking your PDF…", true);
  getWorker().postMessage({ id: ++jobId, bytes, password });
}

function onWorkerMessage(e) {
  const r = e.data;
  if (r.id !== jobId) return;
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
  const base = currentName.replace(/\.pdf$/i, "");
  downloadBtn.href = url;
  downloadBtn.download = base + "_decrypted.pdf";
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
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 1024)));
    if (!head.includes("%PDF-")) {
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
  jobId++;
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

dz.addEventListener("dragover", (e) => {
  e.preventDefault();
  dz.classList.add("dragover");
});
dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("dragover");
  pickFile(e.dataTransfer.files[0]);
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

fileInput.addEventListener("change", () => {
  pickFile(fileInput.files[0]);
  fileInput.value = "";
});

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
