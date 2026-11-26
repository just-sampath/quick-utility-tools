import { encodeJpeg, encodeWebp, encodePng, decodeImage, capSize, JobError } from "../../assets/js/codecs.js";
import { crc32 } from "../../assets/js/zip.js";

const TYPES = { jpeg: ["image/jpeg", "jpg"], webp: ["image/webp", "webp"], png: ["image/png", "png"] };

async function encode(format, imageData, settings) {
  try {
    if (format === "jpeg") return await encodeJpeg(imageData, settings.quality);
    if (format === "webp") return await encodeWebp(imageData, settings.quality);
    return await encodePng(imageData, settings.colors);
  } catch {
    throw new JobError("engine");
  }
}

function targetFactors(settings, bw, bh) {
  let fx = null;
  let fy = null;
  if (settings.unit === "percent") {
    fx = settings.width / 100;
    fy = settings.height / 100;
  } else {
    fx = settings.width ? settings.width / bw : null;
    fy = settings.height ? settings.height / bh : null;
  }
  if (settings.lock) {
    const f = (settings.driver === "w" ? fx : fy) ?? fx ?? fy;
    fx = fy = f;
  }
  return [fx ?? fy ?? 1, fy ?? fx ?? 1];
}

function setPngDpi(buffer, dpi) {
  const src = new Uint8Array(buffer);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  const ppm = Math.round(dpi / 0.0254);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, 33));
  out.set(chunk, 33);
  out.set(src.subarray(33), 54);
  return out.buffer;
}

function setJpegDpi(buffer, dpi) {
  const src = new Uint8Array(buffer);
  const hasJfif = src[2] === 0xff && src[3] === 0xe0 && src[6] === 0x4a && src[7] === 0x46 && src[8] === 0x49 && src[9] === 0x46;
  if (hasJfif) {
    src[13] = 1;
    src[14] = src[16] = dpi >> 8;
    src[15] = src[17] = dpi & 0xff;
    return src.buffer;
  }
  const jfif = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff, 0, 0]);
  const out = new Uint8Array(src.length + jfif.length);
  out.set(src.subarray(0, 2));
  out.set(jfif, 2);
  out.set(src.subarray(2), 2 + jfif.length);
  return out.buffer;
}

async function compress(file, kind, settings, progress) {
  const bitmap = await decodeImage(file, kind, progress);
  const format = settings.format === "same" ? (kind in TYPES ? kind : "jpeg") : settings.format;
  const [fx, fy] = targetFactors(settings, bitmap.width, bitmap.height);
  const { width, height, capped } = capSize(Math.max(1, Math.round(bitmap.width * fx)), Math.max(1, Math.round(bitmap.height * fy)));
  const resized = width !== bitmap.width || height !== bitmap.height;
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
  progress("Compressing…");
  let out = await encode(format, imageData, settings);
  const dpiSkipped = settings.dpi > 0 && format === "webp";
  const dpiWanted = settings.dpi > 0 && !dpiSkipped;
  if (dpiWanted && format === "jpeg") out = setJpegDpi(out, settings.dpi);
  if (dpiWanted && format === "png") out = setPngDpi(out, settings.dpi);
  if (out.byteLength >= file.size && format === kind && !resized && !dpiWanted) {
    return { bytes: await file.arrayBuffer(), type: file.type || TYPES[kind][0], ext: TYPES[kind][1], width, height, kept: true, capped, dpiSkipped };
  }
  return { bytes: out, type: TYPES[format][0], ext: TYPES[format][1], width, height, kept: false, capped, dpiSkipped };
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
