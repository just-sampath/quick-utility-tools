const BASE = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/";
let ready = null;
let logs = [];

function load() {
  if (!ready) {
    importScripts(BASE + "qpdf.js");
    ready = Module({
      locateFile: (f) => BASE + f,
      print: () => {},
      printErr: (t) => logs.push(t),
    });
  }
  return ready;
}

self.onmessage = async (e) => {
  const { bytes, password } = e.data;
  try {
    const q = await load();
    for (const f of ["/in.pdf", "/out.pdf"]) {
      try {
        q.FS.unlink(f);
      } catch {}
    }
    q.FS.writeFile("/in.pdf", new Uint8Array(bytes));
    const args = ["--decrypt", "/in.pdf", "/out.pdf"];
    if (password) args.unshift("--password=" + password);
    let code;
    try {
      code = q.callMain(args);
    } catch {
      code = -1;
    }
    if (code === 0) {
      const out = q.FS.readFile("/out.pdf");
      self.postMessage({ ok: true, bytes: out }, [out.buffer]);
    } else {
      // ponytail: exit 2 conflates wrong password with corrupt file; the %PDF
      // magic-byte check in app.js filters most junk before it gets here
      self.postMessage({ ok: false, needsPassword: !password });
    }
  } catch (err) {
    self.postMessage({ ok: false, fatal: String((err && err.message) || err) });
  }
};
