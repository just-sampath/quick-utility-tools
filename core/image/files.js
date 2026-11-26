import { sniffFile } from "../../assets/js/codecs.js";
import { skippedText } from "./messages.js";

export async function sniffImages(files) {
  const sniffed = await Promise.all(files.map(async (file) => ({ file, ...(await sniffFile(file)) })));
  const entries = sniffed.filter((s) => s.kind && s.kind !== "gif");
  const skipped = sniffed.length - entries.length;
  const gifs = sniffed.filter((s) => s.kind === "gif").length;
  return { entries, message: skipped ? skippedText(skipped, gifs) : "" };
}
