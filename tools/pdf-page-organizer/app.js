import { initTheme } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";

initTheme(document.querySelector(".theme-toggle"));

const organizer = document.getElementById("organizer");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const resetBtn = document.getElementById("resetBtn");
const saveBtn = document.getElementById("saveBtn");
const statPages = document.getElementById("statPages");

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

let pages = [];
let dragging = null;
let thumbUrls = [];

const tool = createPdfFileTool({
  worker: "./organize-worker.js",
  password: {
    form: document.getElementById("passwordBlock"),
    input: document.getElementById("passwordInput"),
    button: document.getElementById("unlockBtn"),
  },
  onFile: load,
  onReset: () => {
    for (const url of thumbUrls) URL.revokeObjectURL(url);
    thumbUrls = [];
    pages = [];
    grid.replaceChildren();
    organizer.hidden = true;
  },
  onBusy: (on) => {
    saveBtn.disabled = on || keptCount() === 0;
    resetBtn.disabled = on || !isDirty();
  },
});

function keptCount() {
  return pages.filter((p) => !p.deleted).length;
}

function isDirty() {
  return pages.some((p, i) => p.orig !== i + 1 || p.turn !== 0 || p.deleted);
}

async function load() {
  const file = tool.file;
  const r = await tool.run({ op: "inspect" }, tool.password ? "Unlocking…" : "Reading your PDF…");
  if (!r || tool.file !== file) return;
  if (!r.ok) {
    tool.fail(r);
    return;
  }
  for (const url of thumbUrls) URL.revokeObjectURL(url);
  const urls = {};
  for (const [key, data] of Object.entries(r.thumbs)) urls[key] = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
  thumbUrls = Object.values(urls);
  showOrganizer(r.pages, urls);
}

function showOrganizer(info, urls) {
  tool.hideMsg();
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

function iconButton(label, icon, extraClass, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "po-btn " + extraClass;
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

  const head = document.createElement("div");
  head.className = "po-card-head";
  const badge = document.createElement("span");
  badge.className = "po-badge";

  const frame = document.createElement("div");
  frame.className = "po-frame";
  const face = document.createElement("div");
  face.className = "po-face";
  if (page.thumb) {
    const img = document.createElement("img");
    img.className = "po-img";
    img.alt = "";
    img.draggable = false;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => img.replaceWith(paper(page)));
    img.src = page.thumb;
    face.append(img);
  } else {
    face.append(paper(page));
  }
  frame.append(face);

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
    earlier: iconButton("Move earlier", ICON.left, "po-move-prev", move(-1)),
    later: iconButton("Move later", ICON.right, "po-move-next", move(1)),
    ccw: iconButton("Rotate left", ICON.ccw, "po-rot-l", () => turn(page, 270)),
    cw: iconButton("Rotate right", ICON.cw, "po-rot-r", () => turn(page, 90)),
    del: iconButton("Delete page", ICON.trash, "po-del-btn", (b) => {
      page.deleted = !page.deleted;
      layout();
      b.focus();
    }),
  };
  head.append(badge, page.btns.del);
  bar.append(page.btns.earlier, page.btns.later, page.btns.ccw, page.btns.cw);

  li.append(head, frame, note, bar);
  page.badge = badge;
  page.note = note;
  page.face = face;

  li.addEventListener("dragstart", (e) => {
    if (page.deleted) {
      e.preventDefault();
      return;
    }
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
  tool.clearResult();
  let position = 0;
  pages.forEach((page, i) => {
    const li = page.el;
    li.classList.toggle("po-deleted", page.deleted);
    li.draggable = !page.deleted;
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
    page.btns.earlier.disabled = page.deleted || i === 0;
    page.btns.later.disabled = page.deleted || i === pages.length - 1;
    page.btns.ccw.disabled = page.deleted;
    page.btns.cw.disabled = page.deleted;
    if (page.shownDeleted !== page.deleted) {
      const del = page.btns.del;
      const label = page.deleted ? "Restore page" : "Delete page";
      del.title = label;
      del.setAttribute("aria-label", label);
      del.innerHTML = page.deleted ? ICON.undo : ICON.trash;
      page.shownDeleted = page.deleted;
    }
    if (grid.children[i] !== li) grid.insertBefore(li, grid.children[i] || null);
  });
  const kept = keptCount();
  summary.textContent = `${kept} of ${pages.length} pages kept`;
  saveBtn.disabled = kept === 0;
  resetBtn.disabled = !isDirty();
}

async function save() {
  const order = pages.filter((p) => !p.deleted).map((p) => ({ page: p.orig, rotate: p.turn }));
  if (!order.length) return;
  const r = await tool.run({ op: "build", order }, "Building your PDF…");
  if (!r) return;
  if (!r.ok) {
    tool.fail(r, "Couldn't build the new PDF.");
    return;
  }
  statPages.textContent = String(order.length);
  tool.showResult(r.bytes, "_organized");
}

saveBtn.addEventListener("click", save);

resetBtn.addEventListener("click", () => {
  pages.sort((a, b) => a.orig - b.orig);
  for (const p of pages) {
    p.turn = 0;
    p.deleted = false;
  }
  layout();
});
