const QPDF_BASE = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/";
let qpdfReady = null;

function loadQpdf() {
  if (!qpdfReady) {
    importScripts(QPDF_BASE + "qpdf.js");
    qpdfReady = Module({
      locateFile: (f) => QPDF_BASE + f,
      print: () => {},
      printErr: () => {},
    });
  }
  return qpdfReady;
}

async function runQpdf(bytes, options) {
  const q = await loadQpdf();
  for (const f of ["/in.pdf", "/out.pdf"]) {
    try {
      q.FS.unlink(f);
    } catch {}
  }
  q.FS.writeFile("/in.pdf", new Uint8Array(bytes));
  let code;
  try {
    code = q.callMain([...options, "/in.pdf", "/out.pdf"]);
  } catch {
    code = -1;
  }
  return { code, out: code === 0 ? q.FS.readFile("/out.pdf") : null };
}
