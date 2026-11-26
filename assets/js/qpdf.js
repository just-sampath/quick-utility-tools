const QPDF_BASE = "https://cdn.jsdelivr.net/npm/@neslinesli93/qpdf-wasm@0.3.0/dist/";
const QPDF_CALL_LIMIT = 100;
let qpdfReady = null;
let qpdfCalls = 0;
let qpdfBroken = false;
let qpdfStderr = "";

function qpdfWorn() {
  return qpdfBroken || qpdfCalls >= QPDF_CALL_LIMIT;
}

function loadQpdf() {
  if (qpdfReady && qpdfWorn()) qpdfReady = null;
  if (!qpdfReady) {
    if (typeof Module !== "function") {
      console.error = (...parts) => {
        qpdfStderr += parts.join(" ") + "\n";
      };
      importScripts(QPDF_BASE + "qpdf.js");
    }
    qpdfCalls = 0;
    qpdfBroken = false;
    qpdfReady = Module({
      locateFile: (f) => QPDF_BASE + f,
      print: () => {},
      printErr: () => {},
    }).then(
      (q) => {
        q.FS.mkdir("/job");
        return q;
      },
      (err) => {
        qpdfReady = null;
        throw err;
      },
    );
  }
  return qpdfReady;
}

function qpdfClearJob(q) {
  for (const f of q.FS.readdir("/job")) {
    if (f !== "." && f !== "..") q.FS.unlink("/job/" + f);
  }
}

function qpdfExec(q, args) {
  qpdfStderr = "";
  qpdfCalls++;
  try {
    return q.callMain(args);
  } catch {
    qpdfBroken = true;
    return -1;
  }
}

function qpdfPasswordProblem() {
  return /password/i.test(qpdfStderr);
}

async function qpdfInput(data) {
  return new Uint8Array(data.file ? await data.file.arrayBuffer() : data.bytes);
}

async function runQpdf(bytes, options) {
  const q = await loadQpdf();
  qpdfClearJob(q);
  q.FS.writeFile("/job/in.pdf", new Uint8Array(bytes));
  const code = qpdfExec(q, [...options, "/job/in.pdf", "/job/out.pdf"]);
  const out = code === 0 ? q.FS.readFile("/job/out.pdf") : null;
  qpdfClearJob(q);
  return { code, out, passwordProblem: qpdfPasswordProblem() };
}
