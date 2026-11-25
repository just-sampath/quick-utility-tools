importScripts("../../assets/js/qpdf.js");

self.onmessage = async (e) => {
  const { id, bytes, password, ownerPassword } = e.data;
  try {
    const q = await loadQpdf();
    qpdfClearJob(q);
    q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
    const probe = qpdfExec(q, ["--requires-password", "/job/in.pdf"]);
    if (probe === 3 || qpdfPasswordProblem()) {
      qpdfClearJob(q);
      self.postMessage({ id, ok: false, alreadyEncrypted: true });
      return;
    }
    const code = qpdfExec(q, ["--encrypt", password, ownerPassword || password, "256", "--", "/job/in.pdf", "/job/out.pdf"]);
    const out = code === 0 ? q.FS.readFile("/job/out.pdf") : null;
    qpdfClearJob(q);
    if (out) {
      self.postMessage({ id, ok: true, bytes: out }, [out.buffer]);
    } else {
      self.postMessage({ id, ok: false });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
