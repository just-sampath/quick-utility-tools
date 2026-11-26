import {
  initTheme,
  formatBytes,
  createJobRunner,
  createStatus,
  downloadName,
  bindDropzone,
  bindWorkspaceDrop,
  initPasswordToggles,
  moveItem,
} from "../../assets/js/common.js";
import { makeZip } from "../../assets/js/zip.js";
import { isPdfFile, looksLikePdf } from "../../core/pdf/files.js";
import { ENGINE_CRASHED, ENGINE_FAILED, REPAIR_HINT, damaged } from "../../core/pdf/messages.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const panel = dz.closest(".panel");
const fileInput = document.getElementById("fileInput");
const fileListBar = document.getElementById("fileListBar");
const fileCount = document.getElementById("fileCount");
const fileList = document.getElementById("fileList");
const options = document.getElementById("options");
const splitHow = document.getElementById("splitHow");
const splitSelect = document.getElementById("splitSelect");
const chunkField = document.getElementById("chunkField");
const chunkInput = document.getElementById("chunkInput");
const rangeField = document.getElementById("rangeField");
const rangeLabel = document.getElementById("rangeLabel");
const rangeInput = document.getElementById("rangeInput");
const modeHint = document.getElementById("modeHint");
const runBtn = document.getElementById("runBtn");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const msg = document.getElementById("msg");
const result = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const statFilesWrap = document.getElementById("statFilesWrap");
const statFilesLabel = document.getElementById("statFilesLabel");
const statFiles = document.getElementById("statFiles");
const statPages = document.getElementById("statPages");
const statSize = document.getElementById("statSize");
const downloadBtn = document.getElementById("downloadBtn");
const itemTemplate = document.getElementById("itemTemplate");

const runner = createJobRunner("./merge-split-worker.js");
const { showMsg, hideMsg } = createStatus(msg);

const MODE_TEXT = {
  merge: { button: "Merge PDFs", hint: "PDFs are joined in the order shown." },
  split: { button: "Split PDF", hint: "Splits the first PDF into separate files as a ZIP." },
  extract: {
    button: "Extract pages",
    hint: "Enter pages or ranges like 1-3,5,8-z (z means the last page).",
  },
};

let items = [];
let nextItemId = 0;
let working = false;
let runToken = 0;
let outUrl = null;

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function stripExt(name) {
  return name.replace(/\.[^./]+$/, "");
}

function parseRanges(text, pages) {
  const parts = text.split(",").map((s) => s.trim());
  const list = [];
  for (const part of parts) {
    const m = /^(\d+|z)(?:\s*-\s*(\d+|z))?$/i.exec(part);
    if (!m) {
      return { error: part ? `"${part}" isn't a valid page range. Use something like 1-3,5,8-z.` : "Enter the pages to use, for example 1-3,5,8-z." };
    }
    const toNum = (s) => (/^z$/i.test(s) ? pages : parseInt(s, 10));
    const a = toNum(m[1]);
    const b = m[2] === undefined ? a : toNum(m[2]);
    for (const n of [a, b]) {
      if (n < 1 || n > pages) {
        return { error: `Page ${n} doesn't exist. This PDF has ${pages} ${pages === 1 ? "page" : "pages"}.` };
      }
    }
    list.push([a, b]);
  }
  return { list };
}

function rangeText([a, b]) {
  return a === b ? String(a) : `${a}-${b}`;
}

function rangeLabelText([a, b]) {
  return a === b ? `page_${a}` : `pages_${a}-${b}`;
}

function isUnused(item) {
  return mode() !== "merge" && items.indexOf(item) > 0;
}

function setItemView(item) {
  const li = item.el;
  const size = li.querySelector(".file-size");
  const form = li.querySelector(".pms-password");
  li.classList.toggle("is-error", item.state === "error" || item.state === "password");
  form.hidden = isUnused(item) || item.state !== "password";
  if (item.state === "checking") {
    size.textContent = `${formatBytes(item.bytes.byteLength)}, checking…`;
  } else if (item.state === "ready") {
    size.textContent = `${formatBytes(item.bytes.byteLength)}, ${item.pages} ${item.pages === 1 ? "page" : "pages"}`;
  } else if (item.state === "password") {
    size.textContent = item.wrong ? "Incorrect password. Try again." : "Password required to open this PDF";
  } else {
    size.textContent = item.error;
  }
}

function renderList() {
  const isMerge = mode() === "merge";
  fileList.replaceChildren(...items.map((it) => it.el));
  items.forEach((it, i) => {
    const unused = !isMerge && i > 0;
    it.el.classList.toggle("is-unused", unused);
    it.el.querySelector(".file-badge").hidden = !unused;
    it.el.querySelector(".order-controls").hidden = !isMerge || items.length < 2;
    it.el.querySelector('[data-act="up"]').disabled = working || i === 0;
    it.el.querySelector('[data-act="down"]').disabled = working || i === items.length - 1;
    it.el.querySelector('[data-act="remove"]').disabled = working;
    it.el.querySelector(".pms-password").hidden = unused || it.state !== "password";
  });
  const has = items.length > 0;
  fileListBar.hidden = !has;
  fileCount.textContent = `${items.length} ${items.length === 1 ? "PDF" : "PDFs"}`;
  fileList.hidden = !has;
  options.hidden = !has;
  dz.hidden = has;
  updateControls();
}

function updateControls() {
  const m = mode();
  const split = splitSelect.value;
  splitHow.hidden = m !== "split";
  chunkField.hidden = !(m === "split" && split === "chunks");
  rangeField.hidden = !(m === "extract" || (m === "split" && split === "ranges"));
  rangeLabel.textContent = m === "extract" ? "Pages to extract" : "Page ranges, one file per range";
  modeHint.textContent =
    m === "split" && split === "ranges"
      ? "Each comma-separated range becomes a file (z means the last page)."
      : MODE_TEXT[m].hint;
  runBtn.textContent = MODE_TEXT[m].button;
  const active = m === "merge" ? items : items.slice(0, 1);
  const usable = m === "merge" ? items.length >= 2 : items.length >= 1;
  runBtn.disabled = working || !usable || active.some((it) => it.state !== "ready");
  addBtn.disabled = working;
  clearBtn.disabled = working;
  fileInput.disabled = working;
  addBtn.hidden = m !== "merge";
  clearBtn.hidden = items.length < 2;
}

function clearResult() {
  result.hidden = true;
  if (outUrl) {
    URL.revokeObjectURL(outUrl);
    outUrl = null;
  }
}

async function inspect(item, password) {
  item.state = "checking";
  setItemView(item);
  updateControls();
  let r;
  try {
    r = await runner.run({ op: "inspect", bytes: item.bytes, password });
  } catch {
    if (!items.includes(item)) return;
    item.state = "error";
    item.error = ENGINE_CRASHED;
    setItemView(item);
    updateControls();
    return;
  }
  if (!items.includes(item)) return;
  if (r.ok) {
    item.state = "ready";
    item.pages = r.pages;
    item.password = password;
  } else if (r.fatal) {
    item.state = "error";
    item.error = ENGINE_FAILED;
  } else if (r.needsPassword || r.wrongPassword) {
    item.state = "password";
    item.wrong = !!r.wrongPassword;
  } else {
    item.state = "error";
    item.error = damaged("read");
  }
  setItemView(item);
  updateControls();
  if (item.state === "password" && !isUnused(item)) item.el.querySelector(".pms-password input").focus();
}

function createItem(file, buf) {
  const el = itemTemplate.content.firstElementChild.cloneNode(true);
  const item = { id: ++nextItemId, name: file.name, bytes: buf, pages: 0, password: "", state: "checking", wrong: false, error: "", el };
  el.querySelector(".file-name").textContent = file.name;
  el.querySelector('[data-act="up"]').addEventListener("click", () => move(item, -1));
  el.querySelector('[data-act="down"]').addEventListener("click", () => move(item, 1));
  el.querySelector('[data-act="remove"]').addEventListener("click", () => remove(item));
  const form = el.querySelector(".pms-password");
  const pw = form.querySelector("input");
  initPasswordToggles(el);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!pw.value) return;
    const value = pw.value;
    pw.value = "";
    inspect(item, value);
  });
  return item;
}

function move(item, delta) {
  if (!moveItem(items, item, delta)) return;
  clearResult();
  renderList();
}

function remove(item) {
  items = items.filter((it) => it !== item);
  clearResult();
  hideMsg();
  renderList();
}

async function addFiles(files) {
  if (working) return;
  const single = mode() !== "merge";
  const accepted = [];
  let rejected = 0;
  for (const file of files) {
    if (!isPdfFile(file)) {
      rejected++;
      continue;
    }
    const buf = await file.arrayBuffer();
    if (!looksLikePdf(buf)) {
      rejected++;
      continue;
    }
    accepted.push(createItem(file, buf));
  }
  if (rejected) {
    showMsg("error", rejected === 1 ? "One file was skipped because it isn't a valid PDF." : `${rejected} files were skipped because they aren't valid PDFs.`);
  } else {
    hideMsg();
  }
  if (!accepted.length) return;
  clearResult();
  if (single) {
    items = items.length <= 1 ? accepted : [...accepted, ...items];
    if (!rejected && items.length > 1) {
      showMsg("info", "Only the first PDF is used here. Other files stay ready for Merge.");
    }
  } else {
    items = [...items, ...accepted];
  }
  renderList();
  for (const item of accepted) inspect(item, "");
}

function plan() {
  const m = mode();
  if (m === "merge") {
    return {
      mode: m,
      files: items.map((it) => ({ bytes: it.bytes, password: it.password })),
      outputs: [items.map((it, i) => ({ file: i, range: "1-z" }))],
      names: ["merged.pdf"],
      pages: items.reduce((n, it) => n + it.pages, 0),
      title: "Merged PDF ready",
      zipName: "merged.zip",
    };
  }
  const item = items[0];
  const base = stripExt(item.name);
  const files = [{ bytes: item.bytes, password: item.password }];
  if (m === "extract") {
    const parsed = parseRanges(rangeInput.value, item.pages);
    if (parsed.error) return { error: parsed.error, focus: rangeInput };
    const text = parsed.list.map(rangeText).join(",");
    const count = parsed.list.reduce((n, [a, b]) => n + Math.abs(b - a) + 1, 0);
    return {
      mode: m,
      files,
      outputs: [[{ file: 0, range: text }]],
      names: [downloadName(item.name, "_extracted", "pdf")],
      pages: count,
      title: "Extracted PDF ready",
      zipName: base + "_extracted.zip",
    };
  }
  let list;
  if (splitSelect.value === "every") {
    list = Array.from({ length: item.pages }, (_, i) => [i + 1, i + 1]);
  } else if (splitSelect.value === "chunks") {
    const n = Number(chunkInput.value);
    if (!Number.isInteger(n) || n < 1) return { error: "Enter a whole number of pages per file, 1 or more.", focus: chunkInput };
    list = [];
    for (let a = 1; a <= item.pages; a += n) list.push([a, Math.min(a + n - 1, item.pages)]);
  } else {
    const parsed = parseRanges(rangeInput.value, item.pages);
    if (parsed.error) return { error: parsed.error, focus: rangeInput };
    list = parsed.list;
  }
  const used = new Set();
  const names = list.map((r) => {
    let name = `${base}_${rangeLabelText(r)}.pdf`;
    for (let k = 2; used.has(name); k++) name = `${base}_${rangeLabelText(r)}_${k}.pdf`;
    used.add(name);
    return name;
  });
  return {
    mode: m,
    files,
    outputs: list.map((r) => [{ file: 0, range: rangeText(r) }]),
    names,
    pages: list.reduce((n, [a, b]) => n + Math.abs(b - a) + 1, 0),
    title: list.length === 1 ? "Split PDF ready" : `${list.length} files ready`,
    zipName: base + "_split.zip",
  };
}

async function run() {
  const p = plan();
  if (p.error) {
    showMsg("error", p.error);
    (p.focus || rangeInput).focus();
    return;
  }
  clearResult();
  working = true;
  const token = ++runToken;
  renderList();
  showMsg("info", "Working…", true);
  let r;
  try {
    r = await runner.run({ op: "build", files: p.files, outputs: p.outputs }, [], (fraction) => {
      if (token === runToken && p.outputs.length > 1) showMsg("info", `Working… ${Math.round(fraction * 100)}%`, true);
    });
  } catch {
    if (token !== runToken) return;
    working = false;
    renderList();
    showMsg("error", ENGINE_CRASHED);
    return;
  }
  if (token !== runToken) return;
  working = false;
  renderList();
  if (!r.ok) {
    showMsg(
      "error",
      r.fatal
        ? ENGINE_FAILED
        : r.passwordProblem
          ? "A PDF in the list couldn't be opened with its password."
          : `The PDF engine couldn't finish. A file may be damaged. ${REPAIR_HINT}`
    );
    return;
  }
  finish(p, r.results);
}

function finish(p, results) {
  const total = results.reduce((n, b) => n + b.byteLength, 0);
  let blob;
  if (results.length === 1) {
    blob = new Blob([results[0]], { type: "application/pdf" });
    downloadBtn.download = p.names[0];
    downloadBtn.textContent = "Download PDF";
  } else {
    blob = makeZip(results.map((bytes, i) => ({ name: p.names[i], bytes })));
    downloadBtn.download = p.zipName;
    downloadBtn.textContent = "Download all as ZIP";
  }
  outUrl = URL.createObjectURL(blob);
  downloadBtn.href = outUrl;
  resultTitle.textContent = p.title;
  if (p.mode === "merge") {
    statFilesWrap.hidden = false;
    statFilesLabel.textContent = "Merged";
    statFiles.textContent = `${p.files.length} PDFs`;
  } else if (results.length > 1) {
    statFilesWrap.hidden = false;
    statFilesLabel.textContent = "Files";
    statFiles.textContent = `${results.length} PDFs`;
  } else {
    statFilesWrap.hidden = true;
  }
  statPages.textContent = String(p.pages);
  statSize.textContent = formatBytes(total);
  hideMsg();
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetAll() {
  runToken++;
  runner.cancel();
  working = false;
  items = [];
  clearResult();
  hideMsg();
  renderList();
}

bindDropzone(dz, fileInput, addFiles);
bindWorkspaceDrop(panel, addFiles, () => !working && items.length > 0);

addBtn.addEventListener("click", () => fileInput.click());
clearBtn.addEventListener("click", resetAll);
runBtn.addEventListener("click", run);

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", () => {
    clearResult();
    hideMsg();
    if (mode() !== "merge" && items.length > 1) {
      showMsg("info", "Only the first PDF is used here. Other files stay ready for Merge.");
    }
    renderList();
  });
}

splitSelect.addEventListener("change", () => {
  clearResult();
  updateControls();
});

for (const input of [rangeInput, chunkInput]) {
  input.addEventListener("input", () => {
    clearResult();
    hideMsg();
  });
}
