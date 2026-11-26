import { encodeJpeg, encodeWebp, encodePng, decodeImage, capSize, JobError } from "../../assets/js/codecs.js";

const TYPES = { jpeg: ["image/jpeg", "jpg"], webp: ["image/webp", "webp"], png: ["image/png", "png"] };

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
  const bitmap = await decodeImage(file, kind, progress);
  const { format } = settings;
  const { width, height, capped } = capSize(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (format === "jpeg") {
    ctx.fillStyle = settings.background === "black" ? "#000" : "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const imageData = ctx.getImageData(0, 0, width, height);
  canvas.width = canvas.height = 0;
  progress("Converting…");
  const bytes = await encode(format, imageData, settings.quality);
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
