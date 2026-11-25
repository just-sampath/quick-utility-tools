importScripts("../../assets/js/qpdf.js");

const MAX_THUMB_BYTES = 2500000;
const MAX_THUMB_TOTAL = 48000000;
const succeeded = (code) => code === 0 || code === 3;

function readJson(q, path) {
  return JSON.parse(new TextDecoder().decode(q.FS.readFile(path)));
}

function deref(objects, value) {
  if (typeof value === "string" && / R$/.test(value)) return objects["obj:" + value]?.value;
  return value;
}

function inherited(objects, dict, key) {
  let node = dict;
  for (let depth = 0; node && depth < 32; depth++) {
    if (node[key] !== undefined) return deref(objects, node[key]);
    node = deref(objects, node["/Parent"]);
  }
  return undefined;
}

function pageSize(objects, dict) {
  const box = inherited(objects, dict, "/CropBox") || inherited(objects, dict, "/MediaBox");
  if (!Array.isArray(box) || box.length < 4) return { w: 612, h: 792 };
  const nums = box.map((v) => Number(deref(objects, v)));
  const w = Math.abs(nums[2] - nums[0]);
  const h = Math.abs(nums[3] - nums[1]);
  return w > 0 && h > 0 ? { w, h } : { w: 612, h: 792 };
}

function pageRotation(objects, dict) {
  const r = Number(inherited(objects, dict, "/Rotate"));
  return Number.isFinite(r) ? ((Math.round(r / 90) * 90) % 360 + 360) % 360 : 0;
}

function pickThumbnail(images) {
  let best = null;
  for (const img of images) {
    if (!Array.isArray(img.filter) || img.filter.length !== 1 || img.filter[0] !== "/DCTDecode") continue;
    if (!/^\/Device(RGB|Gray)$/.test(img.colorspace || "")) continue;
    const area = (img.width || 0) * (img.height || 0);
    if (!best || area > best.area) best = { object: img.object, area };
  }
  return best && best.area > 0 ? best.object : null;
}

function exportThumbnails(q, pw, src, keys) {
  const thumbs = {};
  if (!keys.length) return thumbs;
  const args = [...pw, "--json=2", "--json-key=qpdf", "--json-stream-data=file", "--json-stream-prefix=/job/s", "--decode-level=none"];
  for (const key of keys) args.push("--json-object=" + key.replace(" R", "").replace(" ", ","));
  if (!succeeded(qpdfExec(q, [...args, src, "/job/data.json"]))) return thumbs;
  const exported = readJson(q, "/job/data.json").qpdf[1];
  let total = 0;
  for (const key of keys) {
    const file = exported["obj:" + key]?.stream?.datafile;
    if (!file) continue;
    let data;
    try {
      data = q.FS.readFile(file);
    } catch {
      continue;
    }
    if (data.length > MAX_THUMB_BYTES || total + data.length > MAX_THUMB_TOTAL) continue;
    total += data.length;
    thumbs[key] = data;
  }
  return thumbs;
}

async function inspect(bytes, password) {
  const q = await loadQpdf();
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  const pw = password ? ["--password=" + password] : [];
  const code = qpdfExec(q, [...pw, "--json=2", "--json-key=pages", "--json-key=qpdf", "--json-stream-data=none", "/job/in.pdf", "/job/info.json"]);
  if (!succeeded(code)) {
    const result = { ok: false, needsPassword: !password && qpdfPasswordProblem(), wrongPassword: !!password && qpdfPasswordProblem() };
    qpdfClearJob(q);
    return { result };
  }
  const info = readJson(q, "/job/info.json");
  const objects = info.qpdf[1];
  const pages = info.pages.map((p) => {
    const dict = objects["obj:" + p.object]?.value || {};
    const size = pageSize(objects, dict);
    return { w: size.w, h: size.h, rotation: pageRotation(objects, dict), thumb: pickThumbnail(p.images || []) };
  });
  const keys = [...new Set(pages.map((p) => p.thumb).filter(Boolean))];
  const thumbs = exportThumbnails(q, pw, "/job/in.pdf", keys);
  for (const p of pages) if (p.thumb && !thumbs[p.thumb]) p.thumb = null;
  qpdfClearJob(q);
  return { result: { ok: true, pages, thumbs }, transfer: Object.values(thumbs).map((t) => t.buffer) };
}

async function build(bytes, password, order) {
  const q = await loadQpdf();
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  const args = [];
  if (password) args.push("--password=" + password);
  args.push("/job/in.pdf", "--pages", ".", order.map((o) => o.page).join(","), "--");
  const byAngle = new Map();
  order.forEach((o, i) => {
    if (!o.rotate) return;
    if (!byAngle.has(o.rotate)) byAngle.set(o.rotate, []);
    byAngle.get(o.rotate).push(i + 1);
  });
  for (const [angle, nums] of byAngle) args.push(`--rotate=+${angle}:${nums.join(",")}`);
  args.push("/job/out.pdf");
  const code = qpdfExec(q, args);
  const out = succeeded(code) ? q.FS.readFile("/job/out.pdf") : null;
  qpdfClearJob(q);
  return out;
}

self.onmessage = async (e) => {
  const { id, op, bytes, password, order } = e.data;
  try {
    if (op === "inspect") {
      const { result, transfer } = await inspect(bytes, password);
      self.postMessage({ id, ...result }, transfer || []);
    } else {
      const out = await build(bytes, password, order);
      if (out) self.postMessage({ id, ok: true, bytes: out }, [out.buffer]);
      else self.postMessage({ id, ok: false });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
