importScripts("../../assets/js/qpdf.js");

self.onmessage = async (e) => {
  const { id, bytes, password } = e.data;
  try {
    const options = ["--decrypt"];
    if (password) options.unshift("--password=" + password);
    const { out, passwordProblem } = await runQpdf(bytes, options);
    if (out) {
      self.postMessage({ id, ok: true, bytes: out }, [out.buffer]);
    } else {
      self.postMessage({ id, ok: false, needsPassword: !password && passwordProblem, wrongPassword: !!password && passwordProblem });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, fatal: String((err && err.message) || err) });
  }
};
