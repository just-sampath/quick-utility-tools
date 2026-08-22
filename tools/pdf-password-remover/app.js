import { initTheme } from "../../assets/js/common.js";

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
let bytes = null;
let url = null;
let currentName = "";

const ICONS = {
  spinner: '<span class="spinner" aria-hidden="true"></span>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>',
  info: "",
};

function fmt(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

function showMsg(kind, text, withSpinner = false) {
  msg.className = "msg visible msg-" + kind;
  msg.innerHTML = (withSpinner ? ICONS.spinner : ICONS[kind] || "") + "<span></span>";
  msg.lastElementChild.textContent = text;
}

function hideMsg() {
  msg.className = "msg";
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

let pending = null;

function decrypt(password, viaForm) {
  busy(true);
  hideMsg();
  if (!viaForm) showMsg("info", "Checking your PDF…", true);
  else showMsg("info", "Unlocking…", true);
  pending = { password, viaForm };
  getWorker().postMessage({ bytes, password });
}

function onWorkerMessage(e) {
  const r = e.data;
  busy(false);
  if (r.ok) {
    finish(r.bytes);
    return;
  }
  if (r.fatal) {
    showMsg("error", "Failed to load the PDF engine. Check your connection and reload the page.");
    return;
  }
  if (pending && !pending.viaForm) {
    showPasswordForm(false);
  } else {
    showMsg("error", "Incorrect password — or the file is damaged. Please double-check and try again.");
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
  statBefore.textContent = fmt(bytes.byteLength);
  statAfter.textContent = fmt(outBytes.byteLength);
  hideMsg();
  pwBlock.classList.remove("visible");
  result.classList.add("visible");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showPasswordForm() {
  hideMsg();
  pwBlock.classList.add("visible");
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
    fileSize.textContent = fmt(file.size);
    dz.hidden = true;
    fileRow.hidden = false;
    decrypt("", false);
  });
}

function resetFile() {
  bytes = null;
  currentName = "";
  hideMsg();
  pwInput.value = "";
  pwBlock.classList.remove("visible");
  result.classList.remove("visible");
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
  decrypt(pw, true);
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
