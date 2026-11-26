import { initTheme } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";

initTheme(document.querySelector(".theme-toggle"));

const tool = createPdfFileTool({
  worker: "./decrypt-worker.js",
  password: {
    form: document.getElementById("passwordBlock"),
    input: document.getElementById("passwordInput"),
    button: document.getElementById("unlockBtn"),
  },
  onFile: decrypt,
});

async function decrypt() {
  const r = await tool.run({}, tool.password ? "Unlocking…" : "Checking your PDF…");
  if (!r) return;
  if (r.ok) tool.showResult(r.bytes, "_decrypted");
  else tool.fail(r);
}
