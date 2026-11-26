import {
  initTheme,
  formatBytes,
  createStatus,
  downloadName,
  bindDropzone,
  bindWorkspaceDrop,
  bindRangeSync,
} from "../../assets/js/common.js";

initTheme(document.querySelector(".theme-toggle"));

const $ = (id) => document.getElementById(id);
const dz = $("dropzone");
const panel = dz.closest(".panel");
const fileInput = $("fileInput");
const stage = $("stage");
const view = $("view");
const canvas = $("canvas");
const ctx = canvas.getContext("2d");
const options = $("options");
const imageName = $("imageName");
const angleInput = $("angleInput");
const angleValue = $("angleValue");
const angleReset = $("angleReset");
const ratioSelect = $("ratioSelect");
const cropInputs = { x: $("cropX"), y: $("cropY"), w: $("cropW"), h: $("cropH") };
const formatSelect = $("formatSelect");
const qualityField = $("qualityField");
const qualityRange = $("qualityRange");
const qualityInput = $("qualityInput");
const bgField = $("bgField");
const flipHBtn = $("flipHBtn");
const flipVBtn = $("flipVBtn");
const saveBtn = $("saveBtn");
const result = $("result");
const resultFlag = $("resultFlag");
const downloadBtn = $("downloadBtn");
const { showMsg, hideMsg } = createStatus($("msg"));

const MAX_PIXELS = 16000000;
const PREVIEW_MAX = 3072;
const MIN_CROP = 8;
const HANDLE_HIT = 24;
const GUTTER = 12;
const OUTPUT_TYPES = { jpeg: "image/jpeg", webp: "image/webp", png: "image/png" };
const EXTENSIONS = { jpeg: "jpg", webp: "webp", png: "png" };

let file = null;
let img = null;
let preview = null;
let theme = null;
let quarter = 0;
let fine = 0;
let flipH = false;
let flipV = false;
let crop = { x: 0, y: 0, w: 1, h: 1 };
let scale = 1;
let drag = null;
let downloadUrl = null;
let frame = 0;
let resizeFrame = 0;
let lastViewWidth = 0;
let loadToken = 0;

function dims() {
  const t = ((quarter * 90 + fine) * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  const round = (v) => Math.max(1, Math.round(+v.toFixed(6)));
  return { W: round(img.width * c + img.height * s), H: round(img.width * s + img.height * c) };
}

function paint(g, k, ox, oy, tx = 0, ty = 0, source = img) {
  const { W, H } = dims();
  g.setTransform(k, 0, 0, k, tx - ox * k, ty - oy * k);
  g.translate(W / 2, H / 2);
  g.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  g.rotate(((quarter * 90 + fine) * Math.PI) / 180);
  g.drawImage(source, -img.width / 2, -img.height / 2, img.width, img.height);
}

function makePreview(bitmap) {
  const longSide = Math.max(bitmap.width, bitmap.height);
  if (longSide <= PREVIEW_MAX) return bitmap;
  const f = PREVIEW_MAX / longSide;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bitmap.width * f));
  c.height = Math.max(1, Math.round(bitmap.height * f));
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, 0, 0, c.width, c.height);
  return c;
}

function themeColors() {
  if (!theme) {
    const css = getComputedStyle(document.documentElement);
    theme = {
      surface: css.getPropertyValue("--surface").trim() || "#ffffff",
      surface2: css.getPropertyValue("--surface-2").trim() || "#888",
      accent: css.getPropertyValue("--accent").trim() || "#4f46e5",
    };
  }
  return theme;
}

function ratioValue() {
  const v = ratioSelect.value;
  if (v === "free") return null;
  if (v === "original") {
    const { W, H } = dims();
    return W / H;
  }
  const [a, b] = v.split(":").map(Number);
  return a / b;
}

function fitRatio(box, r) {
  let w = box.w;
  let h = w / r;
  if (h > box.h) {
    h = box.h;
    w = h * r;
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}

function resetCrop() {
  const { W, H } = dims();
  crop = { x: 0, y: 0, w: W, h: H };
  const r = ratioValue();
  if (r) crop = fitRatio(crop, r);
}

function syncInputs() {
  for (const k of ["x", "y", "w", "h"]) cropInputs[k].value = String(crop[k]);
  const { W, H } = dims();
  cropInputs.x.max = String(W - 1);
  cropInputs.y.max = String(H - 1);
  cropInputs.w.max = String(W);
  cropInputs.h.max = String(H);
  $("cropNote").textContent = `Values are in pixels. The picture is ${W} × ${H}.`;
  angleValue.textContent = `${fine}°`;
  angleReset.disabled = fine === 0;
  flipHBtn.setAttribute("aria-pressed", String(flipH));
  flipVBtn.setAttribute("aria-pressed", String(flipV));
}

function outputKind() {
  if (formatSelect.value !== "same") return formatSelect.value;
  const m = file && file.type;
  if (m === "image/jpeg") return "jpeg";
  if (m === "image/webp") return "webp";
  return "png";
}

function syncFormat() {
  const kind = outputKind();
  qualityField.hidden = kind === "png";
  bgField.hidden = kind !== "jpeg";
}

function layout() {
  if (!img) return;
  const { W, H } = dims();
  const cs = getComputedStyle(view);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const availW = Math.max(120, view.clientWidth - padX);
  const maxH = Math.max(260, innerHeight * 0.65);
  const maxImgW = Math.max(60, Math.floor(availW - GUTTER * 2));
  const maxImgH = Math.max(60, Math.floor(maxH - GUTTER * 2));
  scale = Math.min(maxImgW / W, maxImgH / H);
  const imgCssW = Math.max(1, Math.round(W * scale));
  const imgCssH = Math.max(1, Math.round(H * scale));
  const cssW = imgCssW + GUTTER * 2;
  const cssH = imgCssH + GUTTER * 2;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  lastViewWidth = view.clientWidth;
  draw();
}

function requestDraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function draw() {
  if (!img) return;
  const { W, H } = dims();
  const cssW = Math.max(1, parseFloat(canvas.style.width) || canvas.width);
  const dpr = canvas.width / cssW;
  const g = GUTTER * dpr;
  const k = scale * dpr;
  const imgW = W * k;
  const imgH = H * k;
  const colors = themeColors();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(g, g, imgW, imgH);
  ctx.clip();
  ctx.fillStyle = colors.surface2;
  ctx.fillRect(g, g, imgW, imgH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  paint(ctx, k, 0, 0, g, g, preview || img);
  ctx.restore();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const x = g + crop.x * k;
  const y = g + crop.y * k;
  const w = crop.w * k;
  const h = crop.h * k;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(g, g, imgW, y - g);
  ctx.fillRect(g, y + h, imgW, g + imgH - (y + h));
  ctx.fillRect(g, y, x - g, h);
  ctx.fillRect(x + w, y, g + imgW - (x + w), h);

  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    ctx.moveTo(x + (w * i) / 3, y);
    ctx.lineTo(x + (w * i) / 3, y + h);
    ctx.moveTo(x, y + (h * i) / 3);
    ctx.lineTo(x + w, y + (h * i) / 3);
  }
  ctx.stroke();

  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = "#ffffff";
  ctx.strokeRect(x, y, w, h);

  const accent = colors.accent;
  const r = 7 * dpr;
  for (const p of handlePoints(x, y, w, h)) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }
}

function handlePoints(x, y, w, h) {
  const mx = x + w / 2;
  const my = y + h / 2;
  return [
    { n: "nw", x, y },
    { n: "ne", x: x + w, y },
    { n: "sw", x, y: y + h },
    { n: "se", x: x + w, y: y + h },
    { n: "n", x: mx, y },
    { n: "s", x: mx, y: y + h },
    { n: "w", x, y: my },
    { n: "e", x: x + w, y: my },
  ];
}

function hitTest(px, py) {
  const x = crop.x * scale;
  const y = crop.y * scale;
  const w = crop.w * scale;
  const h = crop.h * scale;
  const pts = handlePoints(x, y, w, h);
  let best = null;
  let bestD = HANDLE_HIT;
  const reach = Math.min(HANDLE_HIT, Math.max(10, Math.min(w, h) / 3));
  for (const p of pts) {
    const d = Math.hypot(p.x - px, p.y - py);
    const limit = p.n.length === 2 ? HANDLE_HIT : reach;
    if (d < bestD && d <= limit) {
      best = p.n;
      bestD = d;
    }
  }
  if (best) return best;
  const near = Math.min(HANDLE_HIT / 2, Math.max(6, Math.min(w, h) / 4));
  const inX = px >= x - near && px <= x + w + near;
  const inY = py >= y - near && py <= y + h + near;
  if (inX && Math.abs(py - y) <= near) return "n";
  if (inX && Math.abs(py - (y + h)) <= near) return "s";
  if (inY && Math.abs(px - x) <= near) return "w";
  if (inY && Math.abs(px - (x + w)) <= near) return "e";
  if (px >= x && px <= x + w && py >= y && py <= y + h) return "move";
  return null;
}

const CURSORS = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", move: "move" };

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  const cssW = parseFloat(canvas.style.width) || rect.width || 1;
  const cssH = parseFloat(canvas.style.height) || rect.height || 1;
  return {
    x: ((e.clientX - rect.left) * cssW) / Math.max(1, rect.width) - GUTTER,
    y: ((e.clientY - rect.top) * cssH) / Math.max(1, rect.height) - GUTTER,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function resizeCrop(handle, start, p) {
  const { W, H } = dims();
  const r = ratioValue();
  const px = clamp(p.x, 0, W);
  const py = clamp(p.y, 0, H);
  const left = start.x;
  const top = start.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const min = Math.min(MIN_CROP, W, H);

  if (!r) {
    let l = left;
    let t = top;
    let rt = right;
    let b = bottom;
    if (handle.includes("w")) l = Math.min(px, right - min);
    if (handle.includes("e")) rt = Math.max(px, left + min);
    if (handle.includes("n")) t = Math.min(py, bottom - min);
    if (handle.includes("s")) b = Math.max(py, top + min);
    return { x: Math.round(l), y: Math.round(t), w: Math.round(rt - l), h: Math.round(b - t) };
  }

  if (handle.length === 2) {
    const ax = handle.includes("w") ? right : left;
    const ay = handle.includes("n") ? bottom : top;
    const sx = handle.includes("w") ? -1 : 1;
    const sy = handle.includes("n") ? -1 : 1;
    const maxW = Math.min(sx > 0 ? W - ax : ax, (sy > 0 ? H - ay : ay) * r);
    let w = Math.max(sx * (px - ax), sy * (py - ay) * r, 0);
    w = clamp(w, Math.min(min, maxW), maxW);
    const h = w / r;
    const x = sx > 0 ? ax : ax - w;
    const y = sy > 0 ? ay : ay - h;
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  if (handle === "e" || handle === "w") {
    const maxW = Math.min(handle === "e" ? W - left : right, H * r);
    const w = clamp(handle === "e" ? px - left : right - px, Math.min(min, maxW), maxW);
    const h = w / r;
    const cy = top + start.h / 2;
    return { x: Math.round(handle === "e" ? left : right - w), y: Math.round(clamp(cy - h / 2, 0, H - h)), w: Math.round(w), h: Math.round(h) };
  }

  const maxH = Math.min(handle === "s" ? H - top : bottom, W / r);
  const h = clamp(handle === "s" ? py - top : bottom - py, Math.min(min, maxH), maxH);
  const w = h * r;
  const cx = left + start.w / 2;
  return { x: Math.round(clamp(cx - w / 2, 0, W - w)), y: Math.round(handle === "s" ? top : bottom - h), w: Math.round(w), h: Math.round(h) };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!img) return;
  const p = pointerPos(e);
  const handle = hitTest(p.x, p.y);
  if (!handle) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, handle, start: { ...crop }, origin: p };
});

canvas.addEventListener("pointermove", (e) => {
  const p = pointerPos(e);
  if (!drag) {
    if (e.pointerType === "mouse") canvas.style.cursor = CURSORS[hitTest(p.x, p.y)] || "default";
    return;
  }
  if (e.pointerId !== drag.id) return;
  const { W, H } = dims();
  if (drag.handle === "move") {
    const dx = (p.x - drag.origin.x) / scale;
    const dy = (p.y - drag.origin.y) / scale;
    crop = {
      ...drag.start,
      x: Math.round(clamp(drag.start.x + dx, 0, W - drag.start.w)),
      y: Math.round(clamp(drag.start.y + dy, 0, H - drag.start.h)),
    };
  } else {
    crop = resizeCrop(drag.handle, drag.start, { x: p.x / scale, y: p.y / scale });
  }
  syncInputs();
  requestDraw();
});

function endDrag(e) {
  if (drag && e.pointerId === drag.id) drag = null;
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

function readCropInput(key) {
  const v = Number(cropInputs[key].value);
  return Number.isFinite(v) ? Math.round(v) : crop[key];
}

function onCropInput(key) {
  const { W, H } = dims();
  const r = ratioValue();
  let { x, y, w, h } = crop;
  const v = readCropInput(key);
  if (key === "x") x = v;
  if (key === "y") y = v;
  if (key === "w") {
    w = clamp(v, 1, W);
    if (r) {
      h = Math.round(w / r);
      if (h > H) {
        h = H;
        w = Math.round(h * r);
      }
    }
  }
  if (key === "h") {
    h = clamp(v, 1, H);
    if (r) {
      w = Math.round(h * r);
      if (w > W) {
        w = W;
        h = Math.round(w / r);
      }
    }
  }
  w = clamp(w, 1, W);
  h = clamp(h, 1, H);
  crop = { x: clamp(x, 0, W - w), y: clamp(y, 0, H - h), w, h };
  syncInputs();
  draw();
}

for (const key of Object.keys(cropInputs)) cropInputs[key].addEventListener("change", () => onCropInput(key));

function clearResult() {
  result.hidden = true;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  downloadBtn.removeAttribute("href");
}

function transformChanged() {
  clearResult();
  hideMsg();
  resetCrop();
  syncInputs();
  layout();
}

$("rotateLeftBtn").addEventListener("click", () => {
  quarter = (quarter + 3) % 4;
  transformChanged();
});
$("rotateRightBtn").addEventListener("click", () => {
  quarter = (quarter + 1) % 4;
  transformChanged();
});
flipHBtn.addEventListener("click", () => {
  flipH = !flipH;
  clearResult();
  syncInputs();
  draw();
});
flipVBtn.addEventListener("click", () => {
  flipV = !flipV;
  clearResult();
  syncInputs();
  draw();
});

angleInput.addEventListener("input", () => {
  fine = Number(angleInput.value);
  transformChanged();
});

angleReset.addEventListener("click", () => {
  if (fine === 0) return;
  fine = 0;
  angleInput.value = "0";
  transformChanged();
});

ratioSelect.addEventListener("change", () => {
  clearResult();
  const r = ratioValue();
  if (r) crop = fitRatio(crop, r);
  syncInputs();
  draw();
});

formatSelect.addEventListener("change", () => {
  clearResult();
  syncFormat();
});
bindRangeSync(qualityRange, qualityInput, clearResult);
for (const radio of document.querySelectorAll('input[name="background"]')) radio.addEventListener("change", clearResult);

$("resetBtn").addEventListener("click", () => {
  quarter = 0;
  fine = 0;
  flipH = false;
  flipV = false;
  angleInput.value = "0";
  ratioSelect.value = "free";
  transformChanged();
});

$("newBtn").addEventListener("click", () => fileInput.click());

function scheduleLayout() {
  if (resizeFrame) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (img && view.clientWidth !== lastViewWidth) layout();
  });
}

new ResizeObserver(() => {
  if (img && view.clientWidth !== lastViewWidth) scheduleLayout();
}).observe(view);
addEventListener("orientationchange", () => setTimeout(scheduleLayout, 200));
new MutationObserver(() => {
  theme = null;
  if (img) requestDraw();
}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  theme = null;
  if (img) requestDraw();
});

async function loadFile(f, notice = "") {
  const token = ++loadToken;
  hideMsg();
  showMsg("info", "Opening image…", true);
  let bitmap;
  try {
    bitmap = await createImageBitmap(f, { imageOrientation: "from-image" });
  } catch {
    if (token !== loadToken) return;
    showMsg("error", "Couldn't read this image. Use a JPG, PNG or WebP file. HEIC files only open in browsers that support them.");
    return;
  }
  if (token !== loadToken) {
    bitmap.close();
    return;
  }
  if (img) img.close();
  if (preview && preview !== img) preview.width = preview.height = 0;
  clearResult();
  img = bitmap;
  preview = makePreview(bitmap);
  file = f;
  quarter = 0;
  fine = 0;
  flipH = false;
  flipV = false;
  angleInput.value = "0";
  ratioSelect.value = "free";
  imageName.textContent = `${f.name} · ${img.width} × ${img.height} · ${formatBytes(f.size)}`;
  dz.hidden = true;
  stage.hidden = false;
  options.hidden = false;
  if (notice) showMsg("info", notice);
  else hideMsg();
  syncFormat();
  resetCrop();
  syncInputs();
  layout();
}

function handleFiles(files) {
  if (!files.length) return;
  const notice = files.length > 1 ? "Only the first image was opened. This tool edits one image at a time." : "";
  loadFile(files[0], notice);
}

bindDropzone(dz, fileInput, handleFiles);
bindWorkspaceDrop(panel, handleFiles, () => !!img);

function drawBackground(g, w, h) {
  const bg = document.querySelector('input[name="background"]:checked').value;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = bg === "black" ? "#000000" : "#ffffff";
  g.fillRect(0, 0, w, h);
}

saveBtn.addEventListener("click", async () => {
  if (!img) return;
  saveBtn.disabled = true;
  clearResult();
  showMsg("info", "Creating image…", true);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const kind = outputKind();
    const type = OUTPUT_TYPES[kind];
    let k = 1;
    if (crop.w * crop.h > MAX_PIXELS) k = Math.sqrt(MAX_PIXELS / (crop.w * crop.h));
    const ow = Math.max(1, Math.round(crop.w * k));
    const oh = Math.max(1, Math.round(crop.h * k));
    const out = document.createElement("canvas");
    out.width = ow;
    out.height = oh;
    const g = out.getContext("2d");
    if (kind === "jpeg") drawBackground(g, ow, oh);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    paint(g, ow / crop.w, crop.x, crop.y);
    const q = clamp(Number(qualityInput.value) || 92, 1, 100) / 100;
    const blob = await new Promise((resolve) => out.toBlob(resolve, type, q));
    out.width = out.height = 1;
    if (!blob) throw new Error("encode");
    const gotKind = blob.type === "image/jpeg" ? "jpeg" : blob.type === "image/webp" ? "webp" : "png";
    downloadUrl = URL.createObjectURL(blob);
    downloadBtn.href = downloadUrl;
    downloadBtn.download = downloadName(file.name, "_edited", EXTENSIONS[gotKind]);
    $("statDims").textContent = `${ow} × ${oh} px`;
    $("statBefore").textContent = formatBytes(file.size);
    $("statAfter").textContent = formatBytes(blob.size);
    const notes = [];
    if (k < 1) notes.push(`The result was scaled down from ${crop.w} × ${crop.h} px to stay under this tool's limit of 16 megapixels.`);
    if (gotKind !== kind) notes.push(`This browser can't save ${kind === "webp" ? "WebP" : "JPG"} files, so the image was saved as ${gotKind.toUpperCase()}.`);
    if (blob.size > file.size) notes.push("The new file is larger than the original. Lower the quality or choose JPG or WebP to make it smaller.");
    resultFlag.textContent = notes.join(" ");
    resultFlag.hidden = notes.length === 0;
    hideMsg();
    result.hidden = false;
    result.scrollIntoView({ block: "nearest", behavior: "smooth" });
  } catch {
    showMsg("error", "Couldn't create the image. It may be too large for this device. Try a smaller crop.");
  } finally {
    saveBtn.disabled = false;
  }
});
