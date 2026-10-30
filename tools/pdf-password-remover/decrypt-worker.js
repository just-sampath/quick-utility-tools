importScripts("../../assets/js/qpdf.js");

self.onmessage = async (e) => {
  const { id, bytes, password } = e.data;
  try {
    const options = ["--decrypt"];
    if (password) options.unshift("--password=" + password);
    const { out } = await runQpdf(bytes, options);
    if (out) {
      self.postMessage({ id, ok: true, bytes: out }, [out.buffer]);
    } else {
      // ponytail: exit 2 conflates wrong password with corrupt file; the %PDF
      // magic-byte check in app.js filters most junk before it gets here
      self.postMessage({ id, ok: false, needsPassword: !password });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
