importScripts("../../assets/js/qpdf.js");

const PRESETS = {
  lossless: null,
  balanced: { quality: 75, maxSide: 2000 },
  small: { quality: 55, maxSide: 1300 },
};
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

function candidates(objects, maxSide) {
  const found = [];
  for (const [key, obj] of Object.entries(objects)) {
    const d = obj.stream?.dict;
    if (!d || d["/Subtype"] !== "/Image" || d["/Filter"] !== "/DCTDecode") continue;
    if (d["/BitsPerComponent"] !== 8 || d["/ImageMask"] || d["/Decode"] || d["/DecodeParms"] || Array.isArray(d["/Mask"])) continue;
    const { "/Width": w, "/Height": h } = d;
    if (typeof w !== "number" || typeof h !== "number" || Math.max(w, h) <= maxSide) continue;
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
  const scale = opts.maxSide / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const bytes = await codecs.encodeJpeg(ctx.getImageData(0, 0, width, height), opts.quality, target.gray);
  return { bytes: new Uint8Array(bytes), width, height };
}

async function downsample(q, pw, src, dest, opts, progress) {
  if (!succeeded(qpdfExec(q, [...pw, "--json=2", "--json-key=qpdf", "--json-stream-data=none", src, "/job/dicts.json"]))) return 0;
  const [header, objects] = readJson(q, "/job/dicts.json").qpdf;
  const targets = candidates(objects, opts.maxSide);
  if (!targets.length) return 0;

  const exportArgs = [...pw, "--json=2", "--json-key=qpdf", "--json-stream-data=file", "--json-stream-prefix=/job/s", "--decode-level=none"];
  for (const t of targets) exportArgs.push(`--json-object=${t.num[1]},${t.num[2]}`);
  if (!succeeded(qpdfExec(q, [...exportArgs, src, "/job/data.json"]))) return 0;
  const exported = readJson(q, "/job/data.json").qpdf[1];

  progress("Loading the image engine…");
  codecs ??= await import("../../assets/js/codecs.js");

  const update = {};
  let count = 0;
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
    count++;
  }
  if (!count) return 0;
  q.FS.writeFile("/job/update.json", JSON.stringify({ qpdf: [header, update] }));
  return succeeded(qpdfExec(q, [...pw, src, "--update-from-json=/job/update.json", dest])) ? count : 0;
}

async function compress(q, bytes, password, preset, progress) {
  const pw = password ? ["--password=" + password] : [];
  const opts = PRESETS[preset];
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  let src = "/job/in.pdf";
  let resized = 0;
  if (opts) {
    progress("Converting images…");
    const code = qpdfExec(q, [...pw, "--optimize-images", "--jpeg-quality=92", src, "/job/a.pdf"]);
    if (!succeeded(code)) return { code };
    src = "/job/a.pdf";
    resized = await downsample(q, pw, src, "/job/b.pdf", opts, progress);
    if (resized) src = "/job/b.pdf";
  }
  progress("Compressing…");
  const args = [...pw, ...STRUCTURE];
  if (opts) args.push("--optimize-images", "--jpeg-quality=" + opts.quality);
  const code = qpdfExec(q, [...args, src, "/job/out.pdf"]);
  if (!succeeded(code)) return { code };
  return { code, out: q.FS.readFile("/job/out.pdf"), resized };
}

self.onmessage = async (e) => {
  const { id, bytes, password, preset } = e.data;
  try {
    const q = await loadQpdf();
    const r = await compress(q, bytes, password, preset, (progress) => self.postMessage({ id, progress }));
    qpdfClearJob(q);
    if (r.out) {
      self.postMessage({ id, ok: true, bytes: r.out, resized: r.resized }, [r.out.buffer]);
    } else {
      // ponytail: exit 2 conflates wrong password with corrupt file; the %PDF
      // magic-byte check in app.js filters most junk before it gets here
      self.postMessage({ id, ok: false, needsPassword: r.code === 2 && !password, wrongPassword: r.code === 2 && !!password });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
