const CDN = "https://cdn.jsdelivr.net/npm/";
const JPEG = CDN + "@jsquash/jpeg@1.6.0/";
const WEBP = CDN + "@jsquash/webp@1.5.0/";
const OXIPNG = CDN + "@jsquash/oxipng@2.3.0/";
const IMAGE_Q = CDN + "image-q@4.0.0/dist/esm/image-q.mjs";
const LIBHEIF = CDN + "libheif-js@1.23.5/libheif-wasm/libheif-bundle.mjs";

function lazy(load) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = load().catch((err) => {
        promise = null;
        throw err;
      });
    }
    return promise;
  };
}

const loadJpeg = lazy(() => import(JPEG + "encode.js"));

const loadWebp = lazy(async () => {
  const [{ default: factory }, { initEmscriptenModule }, { defaultOptions }] = await Promise.all([
    import(WEBP + "codec/enc/webp_enc.js"),
    import(WEBP + "utils.js"),
    import(WEBP + "meta.js"),
  ]);
  return { module: await initEmscriptenModule(factory), defaultOptions };
});

const loadOxipng = lazy(async () => {
  const mod = await import(OXIPNG + "codec/pkg/squoosh_oxipng.js");
  await mod.default();
  return mod;
});

const loadImageQ = lazy(() => import(IMAGE_Q));

const loadLibheif = lazy(async () => {
  const { default: factory } = await import(LIBHEIF);
  return await factory();
});

export async function encodeJpeg(imageData, quality, gray = false) {
  const { default: encode } = await loadJpeg();
  return encode(imageData, gray ? { quality, color_space: 1, auto_subsample: false } : { quality });
}

export async function encodeWebp(imageData, quality) {
  const { module, defaultOptions } = await loadWebp();
  const out = module.encode(imageData.data, imageData.width, imageData.height, { ...defaultOptions, quality });
  if (!out) throw new Error("WebP encoding failed");
  return out.buffer;
}

const PALETTE_SAMPLE = 262144;

async function buildPalette({ data, width, height }, colors) {
  const iq = await loadImageQ();
  const step = Math.max(1, Math.ceil(Math.sqrt((width * height) / PALETTE_SAMPLE)));
  const w = Math.ceil(width / step);
  const h = Math.ceil(height / step);
  const sample = new Uint8Array(w * h * 4);
  for (let y = 0, o = 0; y < h; y++) {
    for (let x = 0; x < w; x++, o += 4) {
      const i = (y * step * width + x * step) * 4;
      sample.set(data.subarray(i, i + 4), o);
    }
  }
  const points = iq.utils.PointContainer.fromUint8Array(sample, w, h);
  const palette = iq.buildPaletteSync([points], { colors, paletteQuantization: "wuquant" });
  const flat = new Uint8Array(colors * 4);
  let n = 0;
  for (const p of palette.getPointContainer().getPointArray()) {
    flat.set([p.r, p.g, p.b, p.a > 250 ? 255 : p.a < 5 ? 0 : p.a], n * 4);
    n++;
  }
  return flat.subarray(0, n * 4);
}

function nearest(palette, r, g, b, a) {
  let best = 0;
  let bestDist = Infinity;
  for (let j = 0; j < palette.length; j += 4) {
    const dr = r - palette[j];
    const dg = g - palette[j + 1];
    const db = b - palette[j + 2];
    const da = a - palette[j + 3];
    const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db + 4 * da * da;
    if (dist < bestDist) {
      bestDist = dist;
      best = j;
    }
  }
  return best;
}

function diffuse(cur, next, e, err) {
  cur[e + 4] += (err * 7) / 16;
  next[e - 4] += (err * 3) / 16;
  next[e] += (err * 5) / 16;
  next[e + 4] += err / 16;
}

function ditherToPalette({ data, width, height }, palette) {
  const out = new Uint8Array(data.length);
  const cache = new Int32Array(1 << 19).fill(-1);
  const clear = nearest(palette, 0, 0, 0, 0);
  let cur = new Float32Array((width + 2) * 4);
  let next = new Float32Array((width + 2) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const e = (x + 1) * 4;
      if (data[i + 3] === 0) {
        out.set(palette.subarray(clear, clear + 4), i);
        continue;
      }
      const r = Math.min(255, Math.max(0, data[i] + cur[e]));
      const g = Math.min(255, Math.max(0, data[i + 1] + cur[e + 1]));
      const b = Math.min(255, Math.max(0, data[i + 2] + cur[e + 2]));
      const a = Math.min(255, Math.max(0, data[i + 3] + cur[e + 3]));
      const key = ((r >> 3) << 14) | ((g >> 3) << 9) | ((b >> 3) << 4) | (a >> 4);
      let j = cache[key];
      if (j < 0) j = cache[key] = nearest(palette, r, g, b, a);
      out[i] = palette[j];
      out[i + 1] = palette[j + 1];
      out[i + 2] = palette[j + 2];
      out[i + 3] = palette[j + 3];
      diffuse(cur, next, e, r - palette[j]);
      diffuse(cur, next, e + 1, g - palette[j + 1]);
      diffuse(cur, next, e + 2, b - palette[j + 2]);
      diffuse(cur, next, e + 3, a - palette[j + 3]);
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
  return out;
}

function isGrayscale({ data }) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255 || data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false;
  }
  return true;
}

function ditherGray({ data, width, height }, levels) {
  const out = new Uint8Array(data.length);
  const scale = 255 / (levels - 1);
  let cur = new Float32Array(width + 2);
  let next = new Float32Array(width + 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.min(255, Math.max(0, data[i] + cur[x + 1]));
      const q = Math.round(Math.round(v / scale) * scale);
      const err = v - q;
      cur[x + 2] += (err * 7) / 16;
      next[x] += (err * 3) / 16;
      next[x + 1] += (err * 5) / 16;
      next[x + 2] += err / 16;
      out[i] = out[i + 1] = out[i + 2] = q;
      out[i + 3] = 255;
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
  return out;
}

export async function encodePng(imageData, colors) {
  const oxipng = await loadOxipng();
  let rgba;
  if (!colors) rgba = new Uint8Array(imageData.data.buffer);
  else if (isGrayscale(imageData)) rgba = ditherGray(imageData, colors);
  else rgba = ditherToPalette(imageData, await buildPalette(imageData, colors));
  return oxipng.optimise_raw(rgba, imageData.width, imageData.height, 2, false, true).buffer;
}

export async function decodeHeic(bytes) {
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  const [image] = decoder.decode(new Uint8Array(bytes));
  if (!image) throw new Error("No image found in HEIC file");
  const width = image.get_width();
  const height = image.get_height();
  const data = await new Promise((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d) =>
      d ? resolve(d.data) : reject(new Error("HEIC decoding failed")),
    );
  });
  image.free?.();
  return new ImageData(data, width, height);
}

export const MAX_PIXELS = 16777216;

export function capSize(width, height) {
  if (width * height <= MAX_PIXELS) return { width, height, capped: false };
  const shrink = Math.sqrt(MAX_PIXELS / (width * height));
  return { width: Math.max(1, Math.floor(width * shrink)), height: Math.max(1, Math.floor(height * shrink)), capped: true };
}

export class JobError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function decodeImage(file, kind, progress = () => {}) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (kind !== "heic") throw new JobError(kind === "avif" ? "avif" : "decode");
  }
  progress("Loading the HEIC decoder (first time only)…");
  try {
    return await createImageBitmap(await decodeHeic(await file.arrayBuffer()));
  } catch {
    throw new JobError("heic");
  }
}

const HEIC_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/;
const PROBE_BYTES = 524288;

function pngInfo(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info = { animated: false, dpi: 0 };
  let pos = 8;
  while (pos + 8 <= b.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...b.subarray(pos + 4, pos + 8));
    if (type === "IDAT") break;
    if (type === "acTL") info.animated = true;
    if (type === "pHYs" && pos + 17 <= b.length && b[pos + 16] === 1) info.dpi = Math.round(view.getUint32(pos + 8) * 0.0254);
    pos += 12 + len;
  }
  return info;
}

function jpegDpi(b) {
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = (b[pos + 2] << 8) | b[pos + 3];
    const isJfif = marker === 0xe0 && String.fromCharCode(...b.subarray(pos + 4, pos + 8)) === "JFIF" && len >= 16 && pos + 14 <= b.length;
    if (isJfif) {
      const units = b[pos + 11];
      const x = (b[pos + 12] << 8) | b[pos + 13];
      if (units === 1) return x;
      if (units === 2) return Math.round(x * 2.54);
      return 0;
    }
    pos += 2 + len;
  }
  return 0;
}

export function sniffImage(b) {
  const text = (from, to) => String.fromCharCode(...b.subarray(from, to));
  const plain = { animated: false, dpi: 0 };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ...plain, kind: "jpeg", dpi: jpegDpi(b) };
  if (text(1, 4) === "PNG") return { kind: "png", ...pngInfo(b) };
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return { ...plain, kind: "webp", animated: text(12, 16) === "VP8X" && (b[20] & 2) === 2 };
  if (text(0, 6) === "GIF87a" || text(0, 6) === "GIF89a") return { ...plain, kind: "gif" };
  if (text(4, 8) === "ftyp") {
    if (text(8, 32).includes("avif") || text(8, 12) === "avis") return { ...plain, kind: "avif" };
    if (HEIC_BRANDS.test(text(8, 12))) return { ...plain, kind: "heic" };
  }
  return { ...plain, kind: null };
}

export async function sniffFile(file) {
  return sniffImage(new Uint8Array(await file.slice(0, PROBE_BYTES).arrayBuffer()));
}
