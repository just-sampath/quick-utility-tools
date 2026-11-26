export function isPdfFile(file) {
  return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
}

export function looksLikePdf(buf) {
  return new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength))).includes("%PDF-");
}
