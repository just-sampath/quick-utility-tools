importScripts("../../assets/js/qpdf.js");

const accepted = (code) => code === 0 || code === 3;

function passwordArgs(password) {
  return password ? ["--password=" + password] : [];
}

function inspect(q, input, password) {
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", input);
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

async function prepare(files) {
  const q = await loadQpdf();
  qpdfClearJob(q);
  for (let i = 0; i < files.length; i++) q.FS.writeFile("/job/in" + i + ".pdf", await qpdfInput(files[i]));
  return q;
}

function splitAll(q, files, size, count) {
  const code = qpdfExec(q, ["--empty", "--pages", "/job/in0.pdf", ...passwordArgs(files[0].password), "1-z", "--", "--split-pages=" + size, "/job/sp-%d.pdf"]);
  if (!accepted(code)) return null;
  const names = q.FS.readdir("/job").filter((f) => f.startsWith("sp-")).sort();
  if (names.length !== count) {
    for (const f of names) q.FS.unlink("/job/" + f);
    return null;
  }
  return names.map((f) => {
    const out = q.FS.readFile("/job/" + f);
    q.FS.unlink("/job/" + f);
    return out;
  });
}

async function build({ files, outputs, split }, report) {
  let q = await prepare(files);
  if (split > 0 && files.length === 1) {
    const results = splitAll(q, files, split, outputs.length);
    if (results) {
      qpdfClearJob(q);
      report(1);
      return { ok: true, results };
    }
  }
  const results = [];
  for (let k = 0; k < outputs.length; k++) {
    if (qpdfWorn()) q = await prepare(files);
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
    if (op === "inspect") {
      const input = await qpdfInput(e.data);
      const q = await loadQpdf();
      self.postMessage({ id, ...inspect(q, input, e.data.password) });
      return;
    }
    const r = await build(e.data, (progress) => self.postMessage({ id, progress }));
    if (r.ok) {
      self.postMessage({ id, ok: true, results: r.results }, r.results.map((b) => b.buffer));
    } else {
      self.postMessage({ id, ok: false, passwordProblem: r.passwordProblem });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
