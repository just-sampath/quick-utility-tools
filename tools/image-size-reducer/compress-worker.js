import { encodeJpeg, encodeWebp, encodePng, decodeHeic } from "../../assets/js/codecs.js";

const MAX_PIXELS = 16777216;
const TYPES = { jpeg: ["image/jpeg", "jpg"], webp: ["image/webp", "webp"], png: ["image/png", "png"] };

class JobError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function decode(file, kind, progress) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (kind !== "heic") throw new JobError(kind === "avif" ? "avif" : "decode");
  }
  progress("Loading the HEIC decoder (first time only)…");
  let data;
  try {
    data = await decodeHeic(await file.arrayBuffer());
  } catch {
    throw new JobError("heic");
  }
  return createImageBitmap(data);
}

async function encode(format, imageData, settings) {
  try {
    if (format === "jpeg") return await encodeJpeg(imageData, settings.quality);
    if (format === "webp") return await encodeWebp(imageData, settings.quality);
    return await encodePng(imageData, settings.colors);
  } catch {
    throw new JobError("engine");
  }
}

async function compress(file, kind, settings, progress) {
  const bitmap = await decode(file, kind, progress);
  const format = settings.format === "same" ? (kind in TYPES ? kind : "jpeg") : settings.format;
  const longest = Math.max(bitmap.width, bitmap.height);
  let scale = settings.maxSide && longest > settings.maxSide ? settings.maxSide / longest : 1;
  let capped = false;
  if (bitmap.width * bitmap.height * scale * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height));
    capped = true;
  }
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (format === "jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  progress("Compressing…");
  const out = await encode(format, ctx.getImageData(0, 0, width, height), settings);
  if (out.byteLength >= file.size && format === kind && scale === 1) {
    return { bytes: await file.arrayBuffer(), type: file.type || TYPES[kind][0], ext: TYPES[kind][1], width, height, kept: true, capped };
  }
  return { bytes: out, type: TYPES[format][0], ext: TYPES[format][1], width, height, kept: false, capped };
}

self.onmessage = async (e) => {
  const { id, file, kind, settings } = e.data;
  try {
    const result = await compress(file, kind, settings, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, ok: true, ...result }, [result.bytes]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof JobError ? err.code : "decode" });
  }
};
