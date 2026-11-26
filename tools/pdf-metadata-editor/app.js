import { initTheme } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";
import { damaged } from "../../core/pdf/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const options = document.getElementById("options");
const xmpNote = document.getElementById("xmpNote");
const saveBtn = document.getElementById("saveBtn");
const stripBtn = document.getElementById("stripBtn");
const resultTitle = document.getElementById("resultTitle");
const sizeNote = document.getElementById("sizeNote");
const inputs = [...options.querySelectorAll("[data-key]")];

let original = {};

const tool = createPdfFileTool({
  worker: "./metadata-worker.js",
  password: {
    form: document.getElementById("passwordBlock"),
    input: document.getElementById("passwordInput"),
    button: document.getElementById("unlockBtn"),
  },
  onFile: load,
  onReset: () => {
    options.hidden = true;
    for (const el of inputs) el.value = "";
  },
  onBusy: (on) => {
    saveBtn.disabled = on;
    stripBtn.disabled = on;
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

async function load() {
  const r = await tool.run({ op: "read" }, tool.password ? "Unlocking…" : "Reading your PDF…");
  if (!r) return;
  if (!r.ok) {
    tool.fail(r);
    return;
  }
  tool.hideMsg();
  fillForm(r.fields);
  xmpNote.textContent = r.hasXmp
    ? "This PDF also carries an XMP metadata stream. Saving keeps it as it is, so it can still hold the old values. Strip removes it."
    : "This PDF has no XMP metadata stream.";
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
  resultTitle.textContent = title;
  const grew = r.bytes.byteLength > tool.bytes.byteLength;
  sizeNote.hidden = !grew;
  sizeNote.textContent = grew ? "The new file is larger than the original because the PDF was rewritten." : "";
  tool.showResult(r.bytes, suffix);
}

saveBtn.addEventListener("click", () => {
  const changes = collectChanges();
  if (!Object.keys(changes).length) {
    tool.showMsg("info", "Nothing to save yet. Change a field first.");
    return;
  }
  produce("write", "Edited copy ready", "_edited", "Saving…", { changes });
});

stripBtn.addEventListener("click", () => {
  produce("strip", "Metadata stripped", "_stripped", "Stripping metadata…");
});
