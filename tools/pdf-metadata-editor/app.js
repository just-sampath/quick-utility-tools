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
const xmpNote = document.getElementById("xmpNote");
const saveBtn = document.getElementById("saveBtn");
const stripBtn = document.getElementById("stripBtn");
const pwBlock = document.getElementById("passwordBlock");
const pwInput = document.getElementById("passwordInput");
const unlockBtn = document.getElementById("unlockBtn");
const msg = document.getElementById("msg");
const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const sizeNote = document.getElementById("sizeNote");
const downloadBtn = document.getElementById("downloadBtn");
const anotherBtn = document.getElementById("anotherBtn");
const inputs = [...options.querySelectorAll("[data-key]")];

const runner = createJobRunner("./metadata-worker.js");
const { showMsg, hideMsg } = createStatus(msg);

let bytes = null;
let url = null;
let currentName = "";
let password = "";
let original = {};
let hasXmp = false;

const pad = (n, w = 2) => String(n).padStart(w, "0");

function pdfDateToInput(raw) {
  const m = /^D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?(?:([Zz+-])(\d\d)?'?(\d\d)?)?/.exec(raw || "");
  if (!m) return "";
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", zone, zh = "00", zm = "00"] = m;
  if (!zone) return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const offset = zone === "+" || zone === "-" ? (zone === "-" ? -1 : 1) * (Number(zh) * 60 + Number(zm)) : 0;
  const when = new Date(0);
  when.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
  when.setUTCHours(Number(h), Number(mi) - offset, Number(s));
  if (Number.isNaN(when.getTime())) return "";
  return `${pad(when.getFullYear(), 4)}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`;
}

function inputToPdfDate(value) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(value);
  if (!m) return "";
  const [, y, mo, d, h, mi, s = "00"] = m;
  const off = -new Date(+y, +mo - 1, +d, +h, +mi, +s).getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `D:${y}${mo}${d}${h}${mi}${s}${sign}${pad(Math.floor(abs / 60))}'${pad(abs % 60)}'`;
}

function isDate(el) {
  return el.type === "datetime-local";
}

function fillForm(fields) {
  original = {};
  for (const el of inputs) {
    const key = el.dataset.key;
    el.value = isDate(el) ? pdfDateToInput(fields[key]) : fields[key];
    original[key] = el.value;
  }
}

function collectChanges() {
  const changes = {};
  for (const el of inputs) {
    const key = el.dataset.key;
    if (el.value === original[key]) continue;
    changes[key] = isDate(el) ? inputToPdfDate(el.value) : el.value;
  }
  return changes;
}

function busy(on) {
  unlockBtn.disabled = on;
  saveBtn.disabled = on;
  stripBtn.disabled = on;
  fileInput.disabled = on;
}

async function call(payload, text) {
  busy(true);
  showMsg("info", text, true);
  let r;
  try {
    r = await runner.run({ bytes, password, ...payload });
  } catch {
    busy(false);
    showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    return null;
  }
  busy(false);
  return r;
}

async function load(pw) {
  password = pw;
  const r = await call({ op: "read", password: pw }, pw ? "Unlocking…" : "Reading your PDF…");
  if (!r) return;
  if (r.ok) {
    hideMsg();
    pwBlock.hidden = true;
    fillForm(r.fields);
    hasXmp = r.hasXmp;
    xmpNote.textContent = hasXmp
      ? "This PDF also carries an XMP metadata stream. Saving keeps it as it is, so it can still hold the old values. Strip removes it."
      : "This PDF has no XMP metadata stream.";
    options.hidden = false;
    return;
  }
  if (r.fatal) {
    showMsg("error", "Failed to load the PDF engine. Check your connection and reload the page.");
  } else if (r.needsPassword) {
    hideMsg();
    pwBlock.hidden = false;
    pwInput.focus();
  } else if (r.wrongPassword) {
    showMsg("error", "Incorrect password. Double-check and try again.");
    pwInput.focus();
    pwInput.select();
  } else {
    showMsg("error", "This PDF couldn't be read. It may be damaged. Saving a new copy from another PDF app often fixes this.");
  }
}

async function produce(op, title, suffix, text, extra) {
  result.hidden = true;
  const r = await call({ op, ...extra }, text);
  if (!r) return;
  if (!r.ok) {
    showMsg(
      "error",
      r.fatal ? "Failed to load the PDF engine. Check your connection and reload the page." : "This PDF couldn't be saved. It may be damaged. Saving a new copy from another PDF app often fixes this."
    );
    return;
  }
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(new Blob([r.bytes], { type: "application/pdf" }));
  downloadBtn.href = url;
  downloadBtn.download = downloadName(currentName, suffix, "pdf");
  resultTitle.textContent = title;
  statBefore.textContent = formatBytes(bytes.byteLength);
  statAfter.textContent = formatBytes(r.bytes.byteLength);
  const grew = r.bytes.byteLength > bytes.byteLength;
  sizeNote.hidden = !grew;
  sizeNote.textContent = grew ? "The new file is larger than the original because the PDF was rewritten." : "";
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
    load("");
  });
}

function resetFile() {
  runner.cancel();
  busy(false);
  bytes = null;
  currentName = "";
  password = "";
  hideMsg();
  pwInput.value = "";
  pwBlock.hidden = true;
  options.hidden = true;
  result.hidden = true;
  for (const el of inputs) el.value = "";
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
  load(pw);
});

saveBtn.addEventListener("click", () => {
  const changes = collectChanges();
  if (!Object.keys(changes).length) {
    showMsg("info", "Nothing to save yet. Change a field first.");
    return;
  }
  produce("write", "Edited copy ready", "_edited", "Saving…", { changes });
});

stripBtn.addEventListener("click", () => {
  produce("strip", "Metadata stripped", "_stripped", "Stripping metadata…");
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
