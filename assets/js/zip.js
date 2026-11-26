const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

const CRC_CHUNK = 8 * 1024 * 1024;

function crcUpdate(c, bytes) {
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
}

export function crc32(bytes) {
  return (crcUpdate(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

export async function crc32Async(data) {
  const isBlob = typeof Blob !== "undefined" && data instanceof Blob;
  const size = isBlob ? data.size : data.length;
  let c = 0xffffffff;
  for (let at = 0; at < size; at += CRC_CHUNK) {
    const part = isBlob ? new Uint8Array(await data.slice(at, at + CRC_CHUNK).arrayBuffer()) : data.subarray(at, at + CRC_CHUNK);
    c = crcUpdate(c, part);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

export function makeZip(files) {
  const enc = new TextEncoder();
  const [time, date] = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes, blob, crc: known } of files) {
    const nameBytes = enc.encode(name);
    const data = blob || bytes;
    const length = blob ? blob.size : bytes.length;
    const crc = known ?? crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, length, true);
    local.setUint32(22, length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local, nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, length, true);
    entry.setUint32(24, length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + length;
  }
  const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}

export async function buildZip(files) {
  const entries = [];
  for (const f of files) entries.push({ ...f, crc: await crc32Async(f.blob || f.bytes) });
  return makeZip(entries);
}

function uniqueNames(files) {
  const used = new Set();
  return files.map(({ name, blob }) => {
    let unique = name;
    for (let k = 1; used.has(unique); k++) unique = name.replace(/(\.[^.]+)?$/, ` (${k})$1`);
    used.add(unique);
    return { name: unique, blob };
  });
}

export function bindZipButton(button, zipName, getFiles, onError) {
  const label = button.textContent;
  let url = null;
  let preparing = false;
  let token = 0;
  button.addEventListener("click", (e) => {
    if (url) return;
    e.preventDefault();
    if (preparing) return;
    preparing = true;
    const mine = ++token;
    button.textContent = "Preparing ZIP…";
    const files = uniqueNames(getFiles());
    buildZip(files)
      .then((zip) => {
        if (mine !== token) return;
        url = URL.createObjectURL(zip);
        button.href = url;
        button.download = zipName;
        button.textContent = label;
        button.click();
      })
      .catch(() => {
        if (mine !== token) return;
        button.textContent = label;
        onError();
      })
      .finally(() => {
        if (mine === token) preparing = false;
      });
  });
  return {
    reset() {
      token++;
      preparing = false;
      if (url) URL.revokeObjectURL(url);
      url = null;
      button.href = "#";
      button.textContent = label;
    },
  };
}
