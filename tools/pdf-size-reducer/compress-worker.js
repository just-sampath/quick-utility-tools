importScripts("../../assets/js/qpdf.js");

const STRUCTURE = ["--object-streams=generate", "--compress-streams=y", "--recompress-flate", "--compression-level=9"];
let codecs = null;

const succeeded = (code) => code === 0 || code === 3;

function readJson(q, path) {
  return JSON.parse(new TextDecoder().decode(q.FS.readFile(path)));
}

function resolve(objects, value) {
  return typeof value === "string" && / R$/.test(value) ? objects["obj:" + value]?.value ?? objects["obj:" + value]?.stream?.dict : value;
}

function channels(objects, colorSpace) {
  const cs = resolve(objects, colorSpace);
  if (cs === "/DeviceRGB") return 3;
  if (cs === "/DeviceGray") return 1;
  if (Array.isArray(cs) && cs[0] === "/ICCBased") return resolve(objects, cs[1])?.["/N"];
  return 0;
}

function targetScale(opts, w, h) {
  const scale = opts.unit === "percent" ? opts.size / 100 : opts.size / Math.max(w, h);
  return scale < 1 ? scale : 1;
}

function candidates(objects, opts) {
  const found = [];
  for (const [key, obj] of Object.entries(objects)) {
    const d = obj.stream?.dict;
    if (!d || d["/Subtype"] !== "/Image" || d["/Filter"] !== "/DCTDecode") continue;
    if (d["/BitsPerComponent"] !== 8 || d["/ImageMask"] || d["/Decode"] || d["/DecodeParms"] || Array.isArray(d["/Mask"])) continue;
    const { "/Width": w, "/Height": h } = d;
    if (typeof w !== "number" || typeof h !== "number") continue;
    if (opts.quality >= 100 && targetScale(opts, w, h) >= 1) continue;
    const n = channels(objects, d["/ColorSpace"]);
    if (n !== 1 && n !== 3) continue;
    found.push({ key, num: key.match(/^obj:(\d+) (\d+) R$/), dict: d, gray: n === 1 });
  }
  return found;
}

async function decodeRaw(raw) {
  const blob = new Blob([raw], { type: "image/jpeg" });
  try {
    return await createImageBitmap(blob, { imageOrientation: "none", colorSpaceConversion: "none" });
  } catch {
    return createImageBitmap(blob, { colorSpaceConversion: "none" });
  }
}

async function resizeImage(raw, target, opts) {
  let bitmap;
  try {
    bitmap = await decodeRaw(raw);
  } catch {
    return null;
  }
  if (bitmap.width !== target.dict["/Width"] || bitmap.height !== target.dict["/Height"]) {
    bitmap.close();
    return null;
  }
  const scale = targetScale(opts, bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  canvas.width = canvas.height = 0;
  const bytes = await codecs.encodeJpeg(imageData, opts.quality, target.gray);
  return { bytes: new Uint8Array(bytes), width, height };
}

async function downsample(q, pw, src, dest, opts, progress) {
  if (!succeeded(qpdfExec(q, [...pw, "--json=2", "--json-key=qpdf", "--json-stream-data=none", src, "/job/dicts.json"]))) return { updated: 0, resized: 0 };
  const [header, objects] = readJson(q, "/job/dicts.json").qpdf;
  q.FS.unlink("/job/dicts.json");
  const targets = candidates(objects, opts);
  if (!targets.length) return { updated: 0, resized: 0 };

  const exportArgs = [...pw, "--json=2", "--json-key=qpdf", "--json-stream-data=file", "--json-stream-prefix=/job/s", "--decode-level=none"];
  for (const t of targets) exportArgs.push(`--json-object=${t.num[1]},${t.num[2]}`);
  if (!succeeded(qpdfExec(q, [...exportArgs, src, "/job/data.json"]))) return { updated: 0, resized: 0 };
  const exported = readJson(q, "/job/data.json").qpdf[1];
  q.FS.unlink("/job/data.json");

  progress("Loading the image engine…");
  codecs ??= await import("../../assets/js/codecs.js");

  const update = {};
  let updated = 0;
  let resized = 0;
  for (const [i, t] of targets.entries()) {
    progress(`Resizing images… ${i + 1} of ${targets.length}`);
    const file = exported[t.key]?.stream?.datafile;
    if (!file) continue;
    const raw = q.FS.readFile(file);
    q.FS.unlink(file);
    const out = await resizeImage(raw, t, opts);
    if (!out || out.bytes.byteLength >= raw.byteLength) continue;
    const path = `/job/r-${t.num[1]}.jpg`;
    q.FS.writeFile(path, out.bytes);
    const dict = { ...t.dict, "/Width": out.width, "/Height": out.height };
    delete dict["/Length"];
    update[t.key] = { stream: { dict, datafile: path } };
    updated++;
    if (out.width !== t.dict["/Width"] || out.height !== t.dict["/Height"]) resized++;
  }
  if (!updated) return { updated: 0, resized: 0 };
  q.FS.writeFile("/job/update.json", JSON.stringify({ qpdf: [header, update] }));
  const done = succeeded(qpdfExec(q, [...pw, src, "--update-from-json=/job/update.json", dest]));
  for (const t of Object.values(update)) q.FS.unlink(t.stream.datafile);
  q.FS.unlink("/job/update.json");
  return done ? { updated, resized } : { updated: 0, resized: 0 };
}

async function compress(q, input, password, opts, progress) {
  const pw = password ? ["--password=" + password] : [];
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", input);
  let src = "/job/in.pdf";
  let resized = 0;
  if (opts) {
    progress("Converting images…");
    const code = qpdfExec(q, [...pw, "--optimize-images", "--jpeg-quality=92", src, "/job/a.pdf"]);
    if (!succeeded(code)) return { code, password: qpdfPasswordProblem() };
    q.FS.unlink(src);
    src = "/job/a.pdf";
    const r = await downsample(q, pw, src, "/job/b.pdf", opts, progress);
    resized = r.resized;
    if (r.updated) {
      q.FS.unlink(src);
      src = "/job/b.pdf";
    }
  }
  progress("Compressing…");
  const args = [...pw, ...STRUCTURE];
  if (opts) args.push("--optimize-images", "--jpeg-quality=" + opts.quality);
  const code = qpdfExec(q, [...args, src, "/job/out.pdf"]);
  if (!succeeded(code)) return { code, password: qpdfPasswordProblem() };
  q.FS.unlink(src);
  return { code, out: q.FS.readFile("/job/out.pdf"), resized };
}

self.onmessage = async (e) => {
  const { id, password, preset, unit, size, quality } = e.data;
  const opts = preset === "lossless" ? null : {
    unit: unit === "percent" ? "percent" : "pixels",
    size: Math.max(1, Number(size) || 2000),
    quality: Math.min(100, Math.max(1, Math.round(Number(quality)) || 75)),
  };
  try {
    const input = await qpdfInput(e.data);
    const q = await loadQpdf();
    const r = await compress(q, input, password, opts, (progress) => self.postMessage({ id, progress }));
    qpdfClearJob(q);
    if (r.out) {
      self.postMessage({ id, ok: true, bytes: r.out, resized: r.resized }, [r.out.buffer]);
    } else {
      self.postMessage({ id, ok: false, needsPassword: r.password && !password, wrongPassword: r.password && !!password });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
