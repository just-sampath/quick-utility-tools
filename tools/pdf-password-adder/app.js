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
const form = document.getElementById("passwordBlock");
const pwInput = document.getElementById("passwordInput");
const confirmInput = document.getElementById("confirmInput");
const ownerInput = document.getElementById("ownerInput");
const showBtn = document.getElementById("showBtn");
const protectBtn = document.getElementById("protectBtn");
const msg = document.getElementById("msg");
const result = document.getElementById("result");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const statPerms = document.getElementById("statPerms");
const downloadBtn = document.getElementById("downloadBtn");
const anotherBtn = document.getElementById("anotherBtn");
const allow = {
  print: document.getElementById("allowPrint"),
  copy: document.getElementById("allowCopy"),
  edit: document.getElementById("allowEdit"),
};

const runner = createJobRunner("./encrypt-worker.js");
const { showMsg, hideMsg } = createStatus(msg);
const fields = [pwInput, confirmInput, ownerInput];
const BLOCKED_NAMES = { print: "printing", copy: "copying", edit: "editing" };

let bytes = null;
let url = null;
let currentName = "";

function permissions() {
  return { print: allow.print.checked, copy: allow.copy.checked, edit: allow.edit.checked };
}

function blockedText(perms) {
  const blocked = Object.keys(BLOCKED_NAMES).filter((k) => !perms[k]).map((k) => BLOCKED_NAMES[k]);
  if (!blocked.length) return "None";
  const list = blocked.length > 1 ? blocked.slice(0, -1).join(", ") + " and " + blocked.at(-1) : blocked[0];
  return list.charAt(0).toUpperCase() + list.slice(1) + " blocked";
}

async function protect(password, ownerPassword, perms) {
  busy(true);
  showMsg("info", "Encrypting…", true);
  let r;
  try {
    r = await runner.run({ bytes, password, ownerPassword, permissions: perms });
  } catch {
    busy(false);
    showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    return;
  }
  busy(false);
  if (r.ok) {
    statPerms.textContent = blockedText(perms);
    finish(r.bytes);
  } else if (r.fatal) {
    showMsg("error", "Failed to load the PDF engine. Check your connection and reload the page.");
  } else if (r.alreadyEncrypted) {
    form.hidden = true;
    showMsg("error", "This PDF is already password protected. Remove the password first with the PDF Password Remover.");
  } else {
    showMsg("error", "This PDF couldn't be read. It may be damaged. Saving a new copy from another PDF app often fixes this.");
  }
}

function finish(outBytes) {
  if (url) URL.revokeObjectURL(url);
  const blob = new Blob([outBytes], { type: "application/pdf" });
  url = URL.createObjectURL(blob);
  downloadBtn.href = url;
  downloadBtn.download = downloadName(currentName, "_protected", "pdf");
  statBefore.textContent = formatBytes(bytes.byteLength);
  statAfter.textContent = formatBytes(outBytes.byteLength);
  hideMsg();
  form.hidden = true;
  clearFields();
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function busy(on) {
  protectBtn.disabled = on;
  fileInput.disabled = on;
}

function setVisible(on) {
  for (const f of fields) f.type = on ? "text" : "password";
  showBtn.textContent = on ? "Hide passwords" : "Show passwords";
  showBtn.setAttribute("aria-pressed", String(on));
}

function clearFields() {
  for (const f of fields) f.value = "";
  for (const box of Object.values(allow)) box.checked = true;
  setVisible(false);
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
    form.hidden = false;
    pwInput.focus();
  });
}

function resetFile() {
  runner.cancel();
  busy(false);
  bytes = null;
  currentName = "";
  hideMsg();
  clearFields();
  form.hidden = true;
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

showBtn.addEventListener("click", () => setVisible(showBtn.getAttribute("aria-pressed") !== "true"));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!bytes) return;
  if (!pwInput.value) {
    showMsg("error", "Enter a password.");
    pwInput.focus();
    return;
  }
  if (pwInput.value !== confirmInput.value) {
    showMsg("error", "The passwords don't match.");
    confirmInput.focus();
    return;
  }
  const perms = permissions();
  const restricted = Object.values(perms).includes(false);
  if (restricted && (!ownerInput.value || ownerInput.value === pwInput.value)) {
    showMsg("error", "To block printing, copying or editing, enter an owner password that differs from the password to open the PDF.");
    ownerInput.focus();
    return;
  }
  protect(pwInput.value, ownerInput.value, perms);
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
