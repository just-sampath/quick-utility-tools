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

async function encode(format, imageData, quality) {
  try {
    if (format === "jpeg") return await encodeJpeg(imageData, quality);
    if (format === "webp") return await encodeWebp(imageData, quality);
    return await encodePng(imageData, 0);
  } catch {
    throw new JobError("engine");
  }
}

async function convert(file, kind, settings, progress) {
  const bitmap = await decode(file, kind, progress);
  const { format } = settings;
  let width = bitmap.width;
  let height = bitmap.height;
  let capped = false;
  if (width * height > MAX_PIXELS) {
    const shrink = Math.sqrt(MAX_PIXELS / (width * height));
    width = Math.max(1, Math.floor(width * shrink));
    height = Math.max(1, Math.floor(height * shrink));
    capped = true;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (format === "jpeg") {
    ctx.fillStyle = settings.background === "black" ? "#000" : "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  progress("Converting…");
  const bytes = await encode(format, ctx.getImageData(0, 0, width, height), settings.quality);
  return { bytes, type: TYPES[format][0], ext: TYPES[format][1], width, height, capped };
}

self.onmessage = async (e) => {
  const { id, file, kind, settings } = e.data;
  try {
    const result = await convert(file, kind, settings, (progress) => self.postMessage({ id, progress }));
    self.postMessage({ id, ok: true, ...result }, [result.bytes]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof JobError ? err.code : "decode" });
  }
};
