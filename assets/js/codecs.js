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

export async function encodePng(imageData, colors) {
  const oxipng = await loadOxipng();
  const rgba = colors ? ditherToPalette(imageData, await buildPalette(imageData, colors)) : new Uint8Array(imageData.data.buffer);
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
