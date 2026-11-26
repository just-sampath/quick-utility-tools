import { initTheme } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";
import { damaged } from "../../core/pdf/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const metaWrap = document.getElementById("metaWrap");
const options = document.getElementById("options");
const xmpNote = document.getElementById("xmpNote");
const saveBtn = document.getElementById("saveBtn");
const stripBtn = document.getElementById("stripBtn");
const resultTitle = document.getElementById("resultTitle");
const sizeNote = document.getElementById("sizeNote");
const inputs = [...metaWrap.querySelectorAll("[data-key]")];

let fileValues = {};
let baseline = {};
let hasInfo = false;
let hasXmp = false;
let working = false;

const tool = createPdfFileTool({
  worker: "./metadata-worker.js",
  password: {
    form: document.getElementById("passwordBlock"),
    input: document.getElementById("passwordInput"),
    button: document.getElementById("unlockBtn"),
  },
  onFile: load,
  onReset: () => {
    metaWrap.hidden = true;
    options.hidden = true;
    xmpNote.hidden = true;
    xmpNote.textContent = "";
    fileValues = {};
    baseline = {};
    hasInfo = false;
    hasXmp = false;
    for (const el of inputs) el.value = "";
    syncButtons();
  },
  onBusy: (on) => {
    working = on;
    syncButtons();
  },
});

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

function hasChanges() {
  return inputs.some((el) => el.value !== (baseline[el.dataset.key] || ""));
}

function syncButtons() {
  saveBtn.disabled = working || !hasChanges();
  stripBtn.disabled = working || (!hasInfo && !hasXmp);
}

function syncNote() {
  const anyField = inputs.some((el) => el.value !== "");
  if (hasXmp) {
    xmpNote.textContent = "This PDF also includes XMP metadata. Saving keeps it as is; Strip all metadata removes it.";
    xmpNote.hidden = false;
  } else if (!hasInfo && !anyField) {
    xmpNote.textContent = "No metadata is set on this PDF. Fill in any field to add it.";
    xmpNote.hidden = false;
  } else {
    xmpNote.textContent = "";
    xmpNote.hidden = true;
  }
}

function fillForm(fields) {
  fileValues = {};
  baseline = {};
  for (const el of inputs) {
    const key = el.dataset.key;
    el.value = isDate(el) ? pdfDateToInput(fields[key]) : fields[key];
    fileValues[key] = el.value;
    baseline[key] = el.value;
  }
}

function collectChanges() {
  const changes = {};
  for (const el of inputs) {
    const key = el.dataset.key;
    if (el.value === fileValues[key]) continue;
    changes[key] = isDate(el) ? inputToPdfDate(el.value) : el.value;
  }
  return changes;
}

async function load() {
  const r = await tool.run({ op: "read" }, tool.password ? "Unlocking…" : "Reading your PDF…");
  if (!r) return;
  if (!r.ok) {
    tool.fail(r);
    return;
  }
  tool.hideMsg();
  fillForm(r.fields);
  hasInfo = Boolean(r.hasInfo);
  hasXmp = Boolean(r.hasXmp);
  syncNote();
  syncButtons();
  metaWrap.hidden = false;
  options.hidden = false;
}

async function produce(op, title, suffix, text, extra) {
  tool.clearResult();
  const r = await tool.run({ op, ...extra }, text);
  if (!r) return;
  if (!r.ok) {
    tool.fail(r, damaged("saved"));
    return;
  }
  if (op === "strip") {
    for (const el of inputs) {
      el.value = "";
      baseline[el.dataset.key] = "";
    }
    hasInfo = false;
    hasXmp = false;
  } else {
    for (const el of inputs) baseline[el.dataset.key] = el.value;
    hasInfo = true;
  }
  syncNote();
  syncButtons();
  resultTitle.textContent = title;
  const grew = r.bytes.byteLength > tool.size;
  sizeNote.hidden = !grew;
  sizeNote.textContent = grew ? "The new file is larger than the original because the PDF was rewritten." : "";
  tool.showResult(r.bytes, suffix);
}

for (const el of inputs) {
  const onEdit = () => {
    tool.clearResult();
    syncButtons();
  };
  el.addEventListener("input", onEdit);
  el.addEventListener("change", onEdit);
}

saveBtn.addEventListener("click", () => {
  if (!hasChanges()) return;
  produce("write", "Edited copy ready", "_edited", "Saving…", { changes: collectChanges() });
});

stripBtn.addEventListener("click", () => {
  if (!hasInfo && !hasXmp) return;
  produce("strip", "Metadata stripped", "_stripped", "Stripping metadata…");
});
