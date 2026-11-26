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
const organizer = document.getElementById("organizer");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const resetBtn = document.getElementById("resetBtn");
const saveBtn = document.getElementById("saveBtn");
const result = document.getElementById("result");
const statPages = document.getElementById("statPages");
const statBefore = document.getElementById("statBefore");
const statAfter = document.getElementById("statAfter");
const downloadBtn = document.getElementById("downloadBtn");
const anotherBtn = document.getElementById("anotherBtn");

const runner = createJobRunner("./organize-worker.js");
const { showMsg, hideMsg } = createStatus(msg);

const svg = (path) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICON = {
  left: svg('<path d="m15 18-6-6 6-6"/>'),
  right: svg('<path d="m9 18 6-6-6-6"/>'),
  ccw: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  cw: svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
};

let bytes = null;
let password = "";
let currentName = "";
let url = null;
let pages = [];
let dragging = null;

function busy(on) {
  unlockBtn.disabled = on;
  fileInput.disabled = on;
  saveBtn.disabled = on || keptCount() === 0;
  resetBtn.disabled = on;
}

function keptCount() {
  return pages.filter((p) => !p.deleted).length;
}

function clearResult() {
  result.hidden = true;
  if (url) {
    URL.revokeObjectURL(url);
    url = null;
  }
}

function toDataUrl(data) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(new Blob([data], { type: "image/jpeg" }));
  });
}

async function load(pw) {
  busy(true);
  showMsg("info", pw ? "Unlocking…" : "Reading your PDF…", true);
  const sent = bytes.slice(0);
  let r;
  try {
    r = await runner.run({ op: "inspect", bytes: sent, password: pw }, [sent]);
  } catch {
    busy(false);
    showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    return;
  }
  if (r.ok) {
    password = pw;
    const urls = {};
    await Promise.all(Object.entries(r.thumbs).map(async ([key, data]) => (urls[key] = await toDataUrl(data))));
    if (bytes === null) return;
    showOrganizer(r.pages, urls);
    busy(false);
    return;
  }
  busy(false);
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

function showOrganizer(info, urls) {
  hideMsg();
  pwBlock.hidden = true;
  grid.replaceChildren();
  pages = info.map((p, i) => ({
    orig: i + 1,
    w: p.w,
    h: p.h,
    base: p.rotation,
    thumb: p.thumb && urls[p.thumb] ? urls[p.thumb] : null,
    turn: 0,
    deleted: false,
    el: null,
  }));
  for (const page of pages) page.el = buildCard(page);
  layout();
  organizer.hidden = false;
}

function iconButton(label, icon, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "po-btn";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;
  b.addEventListener("click", () => onClick(b));
  return b;
}

function buildCard(page) {
  const li = document.createElement("li");
  li.className = "po-card";
  li.draggable = true;

  const frame = document.createElement("div");
  frame.className = "po-frame";
  const face = document.createElement("div");
  face.className = "po-face";
  if (page.thumb) {
    const img = document.createElement("img");
    img.className = "po-img";
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => img.replaceWith(paper(page)));
    img.src = page.thumb;
    face.append(img);
  } else {
    face.append(paper(page));
  }
  frame.append(face);

  const badge = document.createElement("span");
  badge.className = "po-badge";
  const note = document.createElement("span");
  note.className = "po-note";

  const bar = document.createElement("div");
  bar.className = "po-bar";
  const move = (delta) => (b) => {
    const from = pages.indexOf(page);
    const to = from + delta;
    if (to < 0 || to >= pages.length) return;
    shift(from, to);
    (b.disabled ? page.btns.del : b).focus();
  };
  page.btns = {
    earlier: iconButton("Move earlier", ICON.left, move(-1)),
    later: iconButton("Move later", ICON.right, move(1)),
    ccw: iconButton("Rotate left", ICON.ccw, () => turn(page, 270)),
    cw: iconButton("Rotate right", ICON.cw, () => turn(page, 90)),
    del: iconButton("Delete page", ICON.trash, (b) => {
      page.deleted = !page.deleted;
      layout();
      b.focus();
    }),
  };
  bar.append(page.btns.earlier, page.btns.ccw, page.btns.cw, page.btns.later, page.btns.del);

  li.append(frame, badge, note, bar);
  page.badge = badge;
  page.note = note;
  page.face = face;

  li.addEventListener("dragstart", (e) => {
    dragging = page;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(page.orig));
    li.classList.add("po-dragging");
  });
  li.addEventListener("dragend", () => {
    dragging = null;
    li.classList.remove("po-dragging");
    for (const p of pages) p.el.classList.remove("po-drop");
  });
  li.addEventListener("dragover", (e) => {
    if (!dragging || dragging === page) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    li.classList.add("po-drop");
  });
  li.addEventListener("dragleave", () => li.classList.remove("po-drop"));
  li.addEventListener("drop", (e) => {
    e.preventDefault();
    li.classList.remove("po-drop");
    if (!dragging || dragging === page) return;
    shift(pages.indexOf(dragging), pages.indexOf(page));
  });
  return li;
}

function paper(page) {
  const sheet = document.createElement("div");
  sheet.className = "po-paper";
  sheet.dataset.shape = page.w > page.h ? "landscape" : "portrait";
  sheet.textContent = String(page.orig);
  return sheet;
}

function shift(from, to) {
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  layout();
}

function turn(page, by) {
  page.turn = (page.turn + by) % 360;
  layout();
}

function layout() {
  clearResult();
  let position = 0;
  const frag = document.createDocumentFragment();
  pages.forEach((page, i) => {
    const li = page.el;
    li.classList.toggle("po-deleted", page.deleted);
    page.face.dataset.rot = String((page.base + page.turn) % 360);
    if (page.deleted) {
      page.badge.textContent = "Deleted";
    } else {
      position++;
      page.badge.textContent = "Page " + position;
    }
    const notes = [];
    if (page.orig !== position || page.deleted) notes.push("was " + page.orig);
    if (page.turn) notes.push("turned " + page.turn + "°");
    page.note.textContent = notes.join(", ");
    page.btns.earlier.disabled = i === 0;
    page.btns.later.disabled = i === pages.length - 1;
    page.btns.ccw.disabled = page.deleted;
    page.btns.cw.disabled = page.deleted;
    const del = page.btns.del;
    const label = page.deleted ? "Restore page" : "Delete page";
    del.title = label;
    del.setAttribute("aria-label", label);
    del.innerHTML = page.deleted ? ICON.undo : ICON.trash;
    frag.append(li);
  });
  grid.replaceChildren(frag);
  const kept = keptCount();
  summary.textContent = `${kept} of ${pages.length} pages kept`;
  saveBtn.disabled = kept === 0;
}

async function save() {
  const order = pages.filter((p) => !p.deleted).map((p) => ({ page: p.orig, rotate: p.turn }));
  if (!order.length) return;
  busy(true);
  showMsg("info", "Building your PDF…", true);
  const sent = bytes.slice(0);
  let r;
  try {
    r = await runner.run({ op: "build", bytes: sent, password, order }, [sent]);
  } catch {
    busy(false);
    showMsg("error", "The PDF engine crashed unexpectedly. Reload the page and try again.");
    return;
  }
  busy(false);
  if (!r.ok) {
    showMsg("error", r.fatal ? "Failed to load the PDF engine. Check your connection and reload the page." : "Couldn't build the new PDF.");
    return;
  }
  hideMsg();
  clearResult();
  url = URL.createObjectURL(new Blob([r.bytes], { type: "application/pdf" }));
  downloadBtn.href = url;
  downloadBtn.download = downloadName(currentName, "_organized", "pdf");
  statPages.textContent = String(order.length);
  statBefore.textContent = formatBytes(bytes.byteLength);
  statAfter.textContent = formatBytes(r.bytes.byteLength);
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function resetFile() {
  runner.cancel();
  bytes = null;
  password = "";
  currentName = "";
  pages = [];
  grid.replaceChildren();
  organizer.hidden = true;
  clearResult();
  hideMsg();
  pwInput.value = "";
  pwBlock.hidden = true;
  busy(false);
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
    load("");
  });
}

bindDropzone(dz, fileInput, (files) => pickFile(files[0]));

clearBtn.addEventListener("click", () => {
  resetFile();
  fileRow.hidden = true;
  dz.hidden = false;
});

pwBlock.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!pwInput.value || !bytes) return;
  load(pwInput.value);
});

saveBtn.addEventListener("click", save);

resetBtn.addEventListener("click", () => {
  pages.sort((a, b) => a.orig - b.orig);
  for (const p of pages) {
    p.turn = 0;
    p.deleted = false;
  }
  layout();
});

anotherBtn.addEventListener("click", () => {
  clearBtn.click();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
