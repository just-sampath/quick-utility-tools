const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LATIN1 = new TextDecoder("latin1");
const UTF8 = new TextDecoder("utf-8");
const MAX_TEXT = 400;

function ascii(b, from, to) {
  let s = "";
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

function startsWith(b, at, text) {
  if (at + text.length > b.length) return false;
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function clip(text) {
  const t = text.replace(/\0+$/, "").trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + "…" : t;
}

function detectFormat(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return "png";
  if (b.length >= 12 && startsWith(b, 0, "RIFF") && startsWith(b, 8, "WEBP")) return "webp";
  return null;
}

function scanJpeg(b) {
  const parts = [];
  let pos = 2;
  parts.push({ start: 0, end: 2, kind: "keep" });
  let sawScan = false;
  while (pos < b.length) {
    if (b[pos] !== 0xff) throw new Error("Damaged JPEG: unexpected data between segments.");
    let p = pos;
    while (p < b.length && b[p] === 0xff) p++;
    if (p >= b.length) throw new Error("Damaged JPEG: file ends inside a segment header.");
    const marker = b[p];
    const hdr = p + 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x00) {
      parts.push({ start: pos, end: hdr, kind: "keep" });
      pos = hdr;
      continue;
    }
    if (marker === 0xd9) {
      parts.push({ start: pos, end: b.length, kind: "keep" });
      pos = b.length;
      sawScan = true;
      break;
    }
    if (hdr + 2 > b.length) throw new Error("Damaged JPEG: file is cut off.");
    const len = (b[hdr] << 8) | b[hdr + 1];
    const end = hdr + len;
    if (len < 2 || end > b.length) throw new Error("Damaged JPEG: file is cut off.");
    if (marker === 0xda) {
      parts.push({ start: pos, end: b.length, kind: "keep" });
      sawScan = true;
      break;
    }
    const part = { start: pos, end, kind: "keep", data: hdr + 2 };
    if (marker === 0xfe) part.kind = "comment";
    else if (marker >= 0xe0 && marker <= 0xef) {
      const d = hdr + 2;
      if (marker === 0xe0 && startsWith(b, d, "JFIF\0")) part.kind = "keep";
      else if (marker === 0xee && startsWith(b, d, "Adobe")) part.kind = "keep";
      else if (marker === 0xe1 && startsWith(b, d, "Exif\0\0")) {
        part.kind = "exif";
        part.data = d + 6;
      } else if (marker === 0xe1 && (startsWith(b, d, "http://ns.adobe.com/xap/1.0/\0") || startsWith(b, d, "http://ns.adobe.com/xmp/extension/\0"))) {
        part.kind = "xmp";
        part.data = d + 29;
      } else if (marker === 0xe2 && startsWith(b, d, "ICC_PROFILE\0")) part.kind = "icc";
      else if (marker === 0xed && startsWith(b, d, "Photoshop 3.0\0")) part.kind = "iptc";
      else part.kind = "other";
    }
    parts.push(part);
    pos = end;
  }
  if (!sawScan) throw new Error("Damaged JPEG: no image data found.");
  return parts;
}

function scanPng(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [{ start: 0, end: 8, kind: "keep" }];
  let pos = 8;
  let sawEnd = false;
  while (pos < b.length) {
    if (pos + 12 > b.length) throw new Error("Damaged PNG: file is cut off.");
    const len = view.getUint32(pos);
    const end = pos + 12 + len;
    if (end > b.length) throw new Error("Damaged PNG: file is cut off.");
    const type = ascii(b, pos + 4, pos + 8);
    const part = { start: pos, end, kind: "keep", type, data: pos + 8, dataEnd: pos + 8 + len };
    if (type === "tEXt" || type === "zTXt") part.kind = "text";
    else if (type === "iTXt") part.kind = "text";
    else if (type === "eXIf") part.kind = "exif";
    else if (type === "tIME") part.kind = "time";
    else if (type === "iCCP") part.kind = "icc";
    parts.push(part);
    pos = end;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new Error("Damaged PNG: no end marker found.");
  if (pos < b.length) parts.push({ start: pos, end: b.length, kind: "keep" });
  if (parts[1].type !== "IHDR") throw new Error("Damaged PNG: header is missing.");
  return parts;
}

function scanWebp(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffEnd = Math.min(8 + view.getUint32(4, true), b.length);
  if (riffEnd < 20) throw new Error("Damaged WebP: file is too short.");
  const parts = [{ start: 0, end: 12, kind: "keep" }];
  let pos = 12;
  while (pos + 8 <= riffEnd) {
    const type = ascii(b, pos, pos + 4);
    const size = view.getUint32(pos + 4, true);
    const end = pos + 8 + size + (size & 1);
    if (pos + 8 + size > riffEnd) throw new Error("Damaged WebP: file is cut off.");
    const part = { start: pos, end: Math.min(end, riffEnd), kind: "keep", type, data: pos + 8, dataEnd: pos + 8 + size };
    if (type === "EXIF") part.kind = "exif";
    else if (type === "XMP ") part.kind = "xmp";
    else if (type === "ICCP") part.kind = "icc";
    else if (type === "VP8X") part.vp8x = true;
    parts.push(part);
    pos = end;
  }
  if (!parts.some((p) => p.type === "VP8 " || p.type === "VP8L" || p.type === "VP8X" || p.type === "ANMF")) {
    throw new Error("Damaged WebP: no image data found.");
  }
  return parts;
}

function scan(b) {
  const format = detectFormat(b);
  if (!format) throw new Error("This isn't a JPEG, PNG or WebP image.");
  const parts = format === "jpeg" ? scanJpeg(b) : format === "png" ? scanPng(b) : scanWebp(b);
  return { format, parts };
}

function tiffOf(b, part, format) {
  if (format === "jpeg") return b.subarray(part.data, part.end);
  let from = part.data;
  if (startsWith(b, from, "Exif\0\0")) from += 6;
  return b.subarray(from, part.dataEnd);
}

const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8];

const IFD0_TAGS = {
  0x010e: "Description",
  0x010f: "Camera make",
  0x0110: "Camera model",
  0x0131: "Software",
  0x0132: "Modified",
  0x013b: "Artist",
  0x8298: "Copyright",
};

const EXIF_TAGS = {
  0x9003: "Taken",
  0x9004: "Digitized",
  0xa433: "Lens make",
  0xa434: "Lens model",
  0x829a: "Exposure time",
  0x829d: "Aperture",
  0x8827: "ISO",
  0x920a: "Focal length",
  0xa002: "Width",
  0xa003: "Height",
};

function parseTiff(t) {
  const out = { entries: [], gps: [], orientation: 1 };
  if (t.length < 8) return out;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return out;
  const view = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  if (u16(2) !== 42) return out;

  function readIfd(off) {
    const tags = new Map();
    if (off < 8 || off + 2 > t.length) return tags;
    let n = u16(off);
    n = Math.min(n, Math.floor((t.length - off - 2) / 12), 512);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 0) * count;
      if (!size) continue;
      const at = size > 4 ? u32(e + 8) : e + 8;
      if (at + size > t.length) continue;
      tags.set(u16(e), { type, count, at });
    }
    return tags;
  }

  function values(tag) {
    const list = [];
    const n = Math.min(tag.count, 64);
    for (let i = 0; i < n; i++) {
      const o = tag.at + i * TYPE_SIZE[tag.type];
      if (tag.type === 3) list.push(u16(o));
      else if (tag.type === 4) list.push(u32(o));
      else if (tag.type === 9) list.push(view.getInt32(o, le));
      else if (tag.type === 1 || tag.type === 7) list.push(t[o]);
      else if (tag.type === 5) list.push({ n: u32(o), d: u32(o + 4) });
      else if (tag.type === 10) list.push({ n: view.getInt32(o, le), d: view.getInt32(o + 4, le) });
    }
    return list;
  }

  function text(tag) {
    if (tag.type !== 2) return "";
    return clip(UTF8.decode(t.subarray(tag.at, tag.at + tag.count)).split("\0")[0]);
  }

  const ratio = (r) => (r && typeof r === "object" && r.d ? r.n / r.d : NaN);
  const dateText = (s) => s.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");

  function describe(id, tag) {
    if (tag.type === 2) {
      const s = text(tag);
      return s && (id === 0x9003 || id === 0x9004 || id === 0x0132 ? dateText(s) : s);
    }
    const v = values(tag);
    if (!v.length) return "";
    if (id === 0x829a) {
      const r = ratio(v[0]);
      if (!(r > 0)) return "";
      return r >= 1 ? `${+r.toFixed(1)} s` : `1/${Math.round(1 / r)} s`;
    }
    if (id === 0x829d) return Number.isFinite(ratio(v[0])) ? `f/${+ratio(v[0]).toFixed(1)}` : "";
    if (id === 0x920a) return Number.isFinite(ratio(v[0])) ? `${+ratio(v[0]).toFixed(1)} mm` : "";
    return typeof v[0] === "number" ? String(v[0]) : "";
  }

  function collect(tags, names) {
    for (const [id, label] of Object.entries(names)) {
      const tag = tags.get(Number(id));
      if (!tag) continue;
      const value = describe(Number(id), tag);
      if (value) out.entries.push({ label, value });
    }
  }

  function dms(tag, ref) {
    const v = tag ? values(tag).map(ratio) : [];
    if (v.length < 3 || v.some((x) => !Number.isFinite(x))) return null;
    const deg = v[0] + v[1] / 60 + v[2] / 3600;
    return ref === "S" || ref === "W" ? -deg : deg;
  }

  try {
    const ifd0 = readIfd(u32(4));
    const orientation = ifd0.get(0x0112);
    if (orientation) {
      const o = values(orientation)[0];
      if (o >= 1 && o <= 8) out.orientation = o;
    }
    collect(ifd0, IFD0_TAGS);
    if (orientation) out.entries.push({ label: "Orientation", value: ORIENTATIONS[out.orientation] });
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr) {
      const exif = readIfd(values(exifPtr)[0]);
      collect(exif, EXIF_TAGS);
    }
    const gpsPtr = ifd0.get(0x8825);
    if (gpsPtr) {
      const gps = readIfd(values(gpsPtr)[0]);
      const ref = (id) => (gps.get(id) ? text(gps.get(id)).charAt(0).toUpperCase() : "");
      const lat = dms(gps.get(2), ref(1));
      const lon = dms(gps.get(4), ref(3));
      if (lat !== null && lon !== null) {
        out.gps.push({ label: "Latitude", value: lat.toFixed(6) });
        out.gps.push({ label: "Longitude", value: lon.toFixed(6) });
      }
      const alt = gps.get(6) ? ratio(values(gps.get(6))[0]) : NaN;
      if (Number.isFinite(alt)) {
        const below = gps.get(5) && values(gps.get(5))[0] === 1;
        out.gps.push({ label: "Altitude", value: `${below ? "-" : ""}${+alt.toFixed(1)} m` });
      }
      if (!out.gps.length && gps.size) out.gps.push({ label: "GPS data", value: "present, no coordinates" });
    }
  } catch {
    return out;
  }
  return out;
}

const ORIENTATIONS = [
  "",
  "Normal",
  "Mirrored horizontally",
  "Rotated 180°",
  "Mirrored vertically",
  "Mirrored, rotated 90° clockwise",
  "Rotated 90° clockwise",
  "Mirrored, rotated 90° counterclockwise",
  "Rotated 90° counterclockwise",
];

function minimalTiff(orientation) {
  return Uint8Array.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
}

function orientationSegment(format, orientation) {
  const tiff = minimalTiff(orientation);
  if (format === "jpeg") {
    const out = new Uint8Array(4 + 6 + tiff.length);
    out.set([0xff, 0xe1, 0x00, 6 + tiff.length + 2, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    out.set(tiff, 10);
    return out;
  }
  if (format === "png") {
    const out = new Uint8Array(12 + tiff.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, tiff.length);
    out.set([0x65, 0x58, 0x49, 0x66], 4);
    out.set(tiff, 8);
    view.setUint32(8 + tiff.length, crc32(out.subarray(4, 8 + tiff.length)));
    return out;
  }
  const out = new Uint8Array(8 + tiff.length);
  out.set([0x45, 0x58, 0x49, 0x46], 0);
  new DataView(out.buffer).setUint32(4, tiff.length, true);
  out.set(tiff, 8);
  return out;
}

function pngText(b, part) {
  const d = b.subarray(part.data, part.dataEnd);
  const nul = d.indexOf(0);
  if (nul < 1) return null;
  const keyword = LATIN1.decode(d.subarray(0, nul));
  if (part.type === "tEXt") return { keyword, value: clip(LATIN1.decode(d.subarray(nul + 1))) };
  if (part.type === "zTXt") return { keyword, value: "compressed text" };
  const compressed = d[nul + 1] === 1;
  let p = nul + 3;
  for (let skip = 0; skip < 2; skip++) {
    const n = d.indexOf(0, p);
    if (n < 0) return { keyword, value: "" };
    p = n + 1;
  }
  const isXmp = keyword === "XML:com.adobe.xmp";
  const value = compressed ? "compressed text" : clip(UTF8.decode(d.subarray(p)));
  return { keyword, value: isXmp ? `XMP packet, ${formatSize(d.length - p)}` : value, xmp: isXmp };
}

function formatSize(n) {
  return n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB`;
}

function xmpSummary(b, from, to) {
  const out = [{ label: "Size", value: formatSize(to - from) }];
  const s = UTF8.decode(b.subarray(from, Math.min(to, from + 65536)));
  const m = s.match(/xmp:CreatorTool(?:="([^"]*)"|>([^<]*)<)/);
  if (m && (m[1] || m[2])) out.push({ label: "Created with", value: clip(m[1] || m[2]) });
  return out;
}

export function readMetadata(bytes) {
  try {
    const { format, parts } = scan(bytes);
    const groups = [];
    const add = (id, label, entries) => groups.push({ id, label, entries });
    let orientation = 1;
    let exifSeen = false;
    let iccSize = 0;
    let otherCount = 0;
    const comments = [];
    const texts = [];
    let times = null;
    for (const part of parts) {
      if (part.kind === "exif" && !exifSeen) {
        exifSeen = true;
        const exif = parseTiff(tiffOf(bytes, part, format));
        orientation = exif.orientation;
        add("exif", "EXIF", exif.entries.length ? exif.entries : [{ label: "Size", value: formatSize(part.end - part.start) }]);
        if (exif.gps.length) add("gps", "GPS location", exif.gps);
      } else if (part.kind === "xmp") {
        if (format === "jpeg") add("xmp", "XMP", xmpSummary(bytes, part.data, part.end));
        else add("xmp", "XMP", xmpSummary(bytes, part.data, part.dataEnd));
      } else if (part.kind === "iptc") {
        add("iptc", "IPTC / Photoshop", [{ label: "Size", value: formatSize(part.end - part.data) }]);
      } else if (part.kind === "icc") {
        iccSize += (part.dataEnd || part.end) - part.data;
      } else if (part.kind === "comment") {
        comments.push({ label: "Comment", value: clip(LATIN1.decode(bytes.subarray(part.data, part.end))) });
      } else if (part.kind === "text") {
        const t = pngText(bytes, part);
        if (t && t.xmp) add("xmp", "XMP", [{ label: "Packet", value: t.value }]);
        else if (t) texts.push({ label: t.keyword, value: t.value });
      } else if (part.kind === "time") {
        const d = bytes.subarray(part.data, part.dataEnd);
        if (d.length === 7) {
          const p = (n) => String(n).padStart(2, "0");
          times = [{ label: "Last modified", value: `${(d[0] << 8) | d[1]}-${p(d[2])}-${p(d[3])} ${p(d[4])}:${p(d[5])}:${p(d[6])}` }];
        }
      } else if (part.kind === "other") {
        otherCount++;
      }
    }
    if (comments.length) add("comment", "Comments", comments);
    if (texts.length) add("text", "Text chunks", texts);
    if (times) add("time", "Timestamp", times);
    if (otherCount) add("other", "Other application data", [{ label: "Segments", value: String(otherCount) }]);
    if (iccSize) add("icc", "Color profile", [{ label: "Size", value: formatSize(iccSize) }]);
    return { ok: true, format, groups, orientation, hasIcc: iccSize > 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Couldn't read this image." };
  }
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function stripMetadata(bytes, options = {}) {
  try {
    const { keepOrientation = true, removeIcc = false } = options;
    const { format, parts } = scan(bytes);
    const firstExif = parts.find((p) => p.kind === "exif");
    const orientation = firstExif ? parseTiff(tiffOf(bytes, firstExif, format)).orientation : 1;
    const chunks = [];
    const removed = new Set();
    let exifKept = false;
    let vp8xAt = -1;
    let total = 0;
    for (const part of parts) {
      const original = bytes.subarray(part.start, part.end);
      let piece = original;
      if (part.kind === "exif") {
        if (keepOrientation && orientation > 1 && !exifKept) {
          exifKept = true;
          piece = orientationSegment(format, orientation);
          if (!sameBytes(piece, original)) removed.add("exif");
        } else {
          piece = null;
          removed.add("exif");
        }
      } else if (part.kind === "icc") {
        if (removeIcc) {
          piece = null;
          removed.add("icc");
        }
      } else if (part.kind !== "keep") {
        piece = null;
        removed.add(part.kind);
      }
      if (part.vp8x) vp8xAt = total;
      if (piece) {
        chunks.push(piece);
        total += piece.length;
      }
    }
    if (!removed.size) return { ok: true, bytes, changed: false, removed: [] };
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    if (format === "webp") {
      new DataView(out.buffer).setUint32(4, total - 8, true);
      if (vp8xAt >= 0) {
        let flags = out[vp8xAt + 8];
        if (!exifKept) flags &= ~0x08;
        flags &= ~0x04;
        if (removeIcc) flags &= ~0x20;
        out[vp8xAt + 8] = flags;
      }
    }
    if (out.length >= bytes.length) return { ok: true, bytes, changed: false, removed: [] };
    return { ok: true, bytes: out, changed: true, removed: [...removed], format };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "Couldn't read this image." };
  }
}
