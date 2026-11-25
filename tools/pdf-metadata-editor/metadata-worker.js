importScripts("../../assets/js/qpdf.js");

const KEYS = ["/Title", "/Author", "/Subject", "/Keywords", "/Creator", "/Producer", "/CreationDate", "/ModDate"];
const REF = /^\d+ \d+ R$/;

function decodeText(raw) {
  if (typeof raw !== "string") return "";
  if (raw.startsWith("u:")) return raw.slice(2);
  if (raw.startsWith("b:")) {
    const hex = raw.slice(2);
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return s;
  }
  return "";
}

function withPassword(password, args) {
  return password ? ["--password=" + password, ...args] : args;
}

function exported(q, bytes, password) {
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  const code = qpdfExec(
    q,
    withPassword(password, ["--json=2", "--json-key=qpdf", "--json-stream-data=none", "/job/in.pdf", "/job/o.json"])
  );
  if (code !== 0 && code !== 3) return { code, passwordProblem: qpdfPasswordProblem() };
  const parts = JSON.parse(new TextDecoder().decode(q.FS.readFile("/job/o.json"))).qpdf;
  return { code, objects: parts[1] || {}, maxId: parts[0].maxobjectid || 0 };
}

function describe(objects) {
  const trailer = (objects.trailer && objects.trailer.value) || {};
  const rootKey = typeof trailer["/Root"] === "string" && REF.test(trailer["/Root"]) ? "obj:" + trailer["/Root"] : null;
  const catalog = rootKey && objects[rootKey] && objects[rootKey].value;
  const infoRaw = trailer["/Info"];
  let info = null;
  let infoKey = null;
  if (typeof infoRaw === "string" && REF.test(infoRaw)) {
    infoKey = "obj:" + infoRaw;
    const o = objects[infoKey];
    if (o && o.value && typeof o.value === "object" && !Array.isArray(o.value)) info = o.value;
  } else if (infoRaw && typeof infoRaw === "object" && !Array.isArray(infoRaw)) {
    info = infoRaw;
  }
  return { trailer, rootKey, catalog, info, infoKey };
}

function finish(q, id, code) {
  if (code !== 0 && code !== 3) {
    qpdfClearJob(q);
    self.postMessage({ id, ok: false, damaged: true });
    return;
  }
  const out = q.FS.readFile("/job/out.pdf");
  qpdfClearJob(q);
  self.postMessage({ id, ok: true, bytes: out }, [out.buffer]);
}

function applyUpdate(q, update, password) {
  q.FS.writeFile("/job/u.json", JSON.stringify({ version: 2, qpdf: [{ jsonversion: 2 }, update] }));
  return qpdfExec(q, withPassword(password, ["--update-from-json=/job/u.json", "/job/in.pdf", "/job/out.pdf"]));
}

self.onmessage = async (e) => {
  const { id, op, bytes, password, changes } = e.data;
  try {
    const q = await loadQpdf();
    const r = exported(q, bytes, password);
    if (!r.objects) {
      qpdfClearJob(q);
      self.postMessage({
        id,
        ok: false,
        needsPassword: !password && r.passwordProblem,
        wrongPassword: !!password && r.passwordProblem,
      });
      return;
    }
    const { trailer, rootKey, catalog, info, infoKey } = describe(r.objects);

    if (op === "read") {
      const fields = {};
      for (const k of KEYS) fields[k] = info ? decodeText(info[k]) : "";
      qpdfClearJob(q);
      self.postMessage({ id, ok: true, fields, hasInfo: !!info, hasXmp: !!(catalog && catalog["/Metadata"]) });
      return;
    }

    const update = {};
    if (op === "strip") {
      const t = { ...trailer };
      delete t["/Info"];
      update.trailer = { value: t };
      if (rootKey && catalog) {
        const c = { ...catalog };
        delete c["/Metadata"];
        update[rootKey] = { value: c };
      }
    } else {
      const next = { ...(info || {}) };
      for (const k of KEYS) {
        if (!(k in changes)) continue;
        if (changes[k]) next[k] = "u:" + changes[k];
        else delete next[k];
      }
      if (info && infoKey) {
        update[infoKey] = { value: next };
      } else if (info) {
        update.trailer = { value: { ...trailer, "/Info": next } };
      } else {
        const key = "obj:" + (r.maxId + 1) + " 0 R";
        update[key] = { value: next };
        update.trailer = { value: { ...trailer, "/Info": r.maxId + 1 + " 0 R" } };
      }
    }
    finish(q, id, applyUpdate(q, update, password));
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
