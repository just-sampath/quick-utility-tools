import { decodeHeic } from "../../assets/js/codecs.js";
import { createPdf, flate } from "./pdf-writer.js";

const MAX_PIXELS = 16777216;
const PX_TO_PT = 0.75;
const PAGES = { a4: [595.28, 841.89], letter: [612, 792] };

class JobError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function jpegInfo(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const info = { components: 0, width: 0, height: 0, orientation: 1, adobe: false };
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2;
      continue;
    }
    const len = (b[pos + 2] << 8) | b[pos + 3];
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(pos + 4, pos + 8)) === "Exif") {
      const t = pos + 10;
      const le = b[t] === 0x49;
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const u16 = (o) => view.getUint16(o, le);
      const u32 = (o) => view.getUint32(o, le);
      if (t + 8 <= b.length) {
        const ifd = t + u32(t + 4);
        if (ifd + 2 <= b.length) {
          const count = u16(ifd);
          for (let i = 0; i < count && ifd + 2 + i * 12 + 12 <= b.length; i++) {
            const e = ifd + 2 + i * 12;
            if (u16(e) === 0x0112) info.orientation = u16(e + 8);
          }
        }
      }
    }
    if (marker === 0xee) info.adobe = true;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      info.baselineOrProgressive = marker === 0xc0 || marker === 0xc1 || marker === 0xc2;
      info.height = (b[pos + 5] << 8) | b[pos + 6];
      info.width = (b[pos + 7] << 8) | b[pos + 8];
      info.components = b[pos + 9];
      return info;
    }
    if (marker === 0xda) break;
    pos += 2 + len;
  }
  return null;
}

async function decodeBitmap(file, heic) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (!heic) throw new JobError("decode");
  }
  try {
    return await createImageBitmap(await decodeHeic(await file.arrayBuffer()));
  } catch {
    throw new JobError("heic");
  }
}

function isHeic(bytes) {
  const text = String.fromCharCode(...bytes.subarray(4, 12));
  return text.startsWith("ftyp") && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(text.slice(4, 8));
}

async function rasterize(file, head) {
  let bitmap = await decodeBitmap(file, isHeic(head));
  let { width, height } = bitmap;
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  const alpha = new Uint8Array(w * h);
  let hasAlpha = false;
  for (let i = 0, p = 0, q = 0; i < rgba.length; i += 4, p += 3, q++) {
    rgb[p] = rgba[i];
    rgb[p + 1] = rgba[i + 1];
    rgb[p + 2] = rgba[i + 2];
    const a = rgba[i + 3];
    alpha[q] = a;
    if (a !== 255) hasAlpha = true;
  }
  return {
    width: w,
    height: h,
    scaled: scale < 1,
    colorSpace: "DeviceRGB",
    filter: "FlateDecode",
    data: await flate(rgb),
    alpha: hasAlpha ? await flate(alpha) : null,
  };
}

async function prepare(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (head[0] === 0xff && head[1] === 0xd8) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = jpegInfo(bytes);
    const direct =
      info &&
      info.baselineOrProgressive &&
      info.orientation === 1 &&
      (info.components === 1 || info.components === 3) &&
      info.width * info.height <= MAX_PIXELS;
    if (direct) {
      return {
        width: info.width,
        height: info.height,
        colorSpace: info.components === 1 ? "DeviceGray" : "DeviceRGB",
        filter: "DCTDecode",
        data: bytes,
        alpha: null,
      };
    }
  }
  return rasterize(file, head);
}

function layout(img, settings) {
  const iw = img.width * PX_TO_PT;
  const ih = img.height * PX_TO_PT;
  const margin = settings.margin;
  if (settings.page === "fit") {
    return { pw: iw + margin * 2, ph: ih + margin * 2, x: margin, y: margin, w: iw, h: ih };
  }
  let [pw, ph] = PAGES[settings.page];
  if (img.width > img.height) [pw, ph] = [ph, pw];
  const availW = pw - margin * 2;
  const availH = ph - margin * 2;
  const s = Math.min(availW / iw, availH / ih);
  const w = iw * s;
  const h = ih * s;
  return { pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

const num = (n) => n.toFixed(2);

async function convert(files, settings, id) {
  const pdf = createPdf();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const infoId = pdf.reserve();
  const pageIds = [];
  const skipped = [];
  const notes = new Set();

  for (let i = 0; i < files.length; i++) {
    self.postMessage({ id, progress: `Adding image ${i + 1} of ${files.length}…` });
    let img;
    try {
      img = await prepare(files[i]);
    } catch (err) {
      skipped.push({ index: i, code: err instanceof JobError ? err.code : "decode" });
      continue;
    }
    if (img.scaled) notes.add("scaled");
    const imageId = pdf.reserve();
    const contentId = pdf.reserve();
    const pageId = pdf.reserve();
    let smaskId = null;
    if (img.alpha) {
      smaskId = pdf.reserve();
      pdf.object(
        smaskId,
        `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        img.alpha,
      );
    }
    pdf.object(
      imageId,
      `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.colorSpace} /BitsPerComponent 8 /Filter /${img.filter}` +
        (smaskId ? ` /SMask ${smaskId} 0 R` : ""),
      img.data,
    );
    const l = layout(img, settings);
    const content = new TextEncoder().encode(`q ${num(l.w)} 0 0 ${num(l.h)} ${num(l.x)} ${num(l.y)} cm /Im0 Do Q`);
    pdf.object(contentId, "", content);
    pdf.object(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(l.pw)} ${num(l.ph)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  if (!pageIds.length) throw new JobError("none");

  pdf.object(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((p) => p + " 0 R").join(" ")}] >>`);
  pdf.object(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(infoId, "<< /Producer (Quick Utility Tools) >>");
  return { blob: pdf.finish(catalogId, infoId), skipped, pages: pageIds.length, notes: [...notes] };
}

self.onmessage = async (e) => {
  const { id, files, settings } = e.data;
  try {
    const out = await convert(files, settings, id);
    self.postMessage({ id, ...out });
  } catch (err) {
    self.postMessage({ id, error: err instanceof JobError ? err.code : "crashed" });
  }
};
