importScripts("../../assets/js/qpdf.js");

const accepted = (code) => code === 0 || code === 3;

function passwordArgs(password) {
  return password ? ["--password=" + password] : [];
}

function inspect(q, { bytes, password }) {
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  const code = qpdfExec(q, [...passwordArgs(password), "--json=2", "--json-key=pages", "/job/in.pdf", "/job/pages.json"]);
  const passwordProblem = qpdfPasswordProblem();
  let pages = 0;
  if (accepted(code)) {
    try {
      pages = JSON.parse(new TextDecoder().decode(q.FS.readFile("/job/pages.json"))).pages.length;
    } catch {
      pages = 0;
    }
  }
  qpdfClearJob(q);
  if (pages > 0) return { ok: true, pages };
  return { ok: false, needsPassword: !password && passwordProblem, wrongPassword: !!password && passwordProblem };
}

function build(q, { files, outputs }, report) {
  qpdfClearJob(q);
  files.forEach((f, i) => q.FS.writeFile("/job/in" + i + ".pdf", new Uint8Array(f.bytes)));
  const results = [];
  for (let k = 0; k < outputs.length; k++) {
    const args = ["--empty", "--pages"];
    for (const part of outputs[k]) {
      args.push("/job/in" + part.file + ".pdf", ...passwordArgs(files[part.file].password), part.range);
    }
    args.push("--", "/job/out.pdf");
    const code = qpdfExec(q, args);
    if (!accepted(code)) {
      qpdfClearJob(q);
      return { ok: false, passwordProblem: qpdfPasswordProblem() };
    }
    results.push(q.FS.readFile("/job/out.pdf"));
    q.FS.unlink("/job/out.pdf");
    report((k + 1) / outputs.length);
  }
  qpdfClearJob(q);
  return { ok: true, results };
}

self.onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    const q = await loadQpdf();
    if (op === "inspect") {
      self.postMessage({ id, ...inspect(q, e.data) });
      return;
    }
    const r = build(q, e.data, (progress) => self.postMessage({ id, progress }));
    if (r.ok) {
      self.postMessage({ id, ok: true, results: r.results }, r.results.map((b) => b.buffer));
    } else {
      self.postMessage({ id, ok: false, passwordProblem: r.passwordProblem });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
