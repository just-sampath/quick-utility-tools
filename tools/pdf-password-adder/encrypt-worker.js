importScripts("../../assets/js/qpdf.js");

function encryptArgs(password, ownerPassword, permissions = {}) {
  const args = ["--encrypt", "--user-password=" + password, "--owner-password=" + (ownerPassword || password), "--bits=256"];
  if (permissions.print === false) args.push("--print=none");
  if (permissions.copy === false) args.push("--extract=n");
  if (permissions.edit === false) args.push("--modify=none");
  return [...args, "--"];
}

self.onmessage = async (e) => {
  const { id, op, password, ownerPassword, permissions } = e.data;
  try {
    const input = await qpdfInput(e.data);
    const q = await loadQpdf();
    qpdfClearJob(q);
    q.FS.writeFile("/job/in.pdf", input);
    const probe = qpdfExec(q, ["--requires-password", "/job/in.pdf"]);
    if (probe === 0 || probe === 3 || qpdfPasswordProblem()) {
      qpdfClearJob(q);
      self.postMessage({ id, ok: false, alreadyEncrypted: true });
      return;
    }
    if (op === "check") {
      qpdfClearJob(q);
      self.postMessage({ id, ok: true });
      return;
    }
    const code = qpdfExec(q, [...encryptArgs(password, ownerPassword, permissions), "/job/in.pdf", "/job/out.pdf"]);
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
