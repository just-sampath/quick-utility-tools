export const DECODE_ERRORS = {
  decode: "Couldn't read this image.",
  avif: "This browser can't open AVIF images.",
  heic: "Couldn't read this HEIC image.",
};

export const ANIM_NOTE = "animated, only the first frame is kept";
export const CAP_LIMIT = "about 16.7 megapixels, the browser limit";
export const OLD_BROWSER = "This browser is too old for this tool. Please update it, or try a current version of Chrome, Edge, Firefox or Safari.";
export const ZIP_FAILED = "Couldn't prepare the ZIP. Download the images one by one instead.";

export function skippedText(skipped, gifs) {
  const plural = skipped > 1;
  const gifNote = gifs ? " GIF images aren't supported, because only the first frame would be kept." : "";
  return `Skipped ${skipped} file${plural ? "s" : ""} that ${plural ? "aren't" : "isn't a"} JPG, PNG, WebP, HEIC or AVIF image${plural ? "s" : ""}.${gifNote}`;
}

export function sizeChange(before, after) {
  const pct = Math.min(99, Math.round((1 - after / before) * 100));
  return { text: pct > 0 ? `−${pct}%` : pct < 0 ? `+${-pct}%` : "Same size", smaller: pct > 0 };
}
