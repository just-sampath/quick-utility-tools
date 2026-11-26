import { formatBytes, createJobRunner, createStatus, downloadName, bindDropzone, initPasswordToggles } from "../../assets/js/common.js";
import { isPdfFile, looksLikePdf } from "./files.js";
import { NOT_PDF, BAD_PDF, ENGINE_CRASHED, ENGINE_FAILED, WRONG_PASSWORD, damaged } from "./messages.js";

export function createPdfFileTool({ worker, password = null, onFile, onUnlock = onFile, onReset = () => {}, onBusy = () => {} }) {
  const dz = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileRow = document.getElementById("fileRow");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const clearBtn = document.getElementById("clearBtn");
  const result = document.getElementById("result");
  const statBefore = document.getElementById("statBefore");
  const statAfter = document.getElementById("statAfter");
  const downloadBtn = document.getElementById("downloadBtn");
  const anotherBtn = document.getElementById("anotherBtn");

  const runner = createJobRunner(worker);
  const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));
  const state = { bytes: null, name: "", password: "" };
  let url = null;

  function busy(on) {
    fileInput.disabled = on;
    if (password) password.button.disabled = on;
    onBusy(on);
  }

  function clearResult() {
    result.hidden = true;
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  function reset() {
    runner.cancel();
    state.bytes = null;
    state.name = "";
    state.password = "";
    hideMsg();
    if (password) {
      password.input.value = "";
      password.input.type = "password";
      const toggle = password.input.closest(".password-wrap")?.querySelector("[data-password-toggle]");
      if (toggle) {
        toggle.setAttribute("aria-pressed", "false");
        toggle.setAttribute("aria-label", "Show password");
      }
      password.form.hidden = true;
    }
    clearResult();
    onReset();
    busy(false);
  }

  function pick(file) {
    if (!file) return;
    if (!isPdfFile(file)) {
      reset();
      showMsg("error", NOT_PDF);
      return;
    }
    file.arrayBuffer().then((buf) => {
      reset();
      if (!looksLikePdf(buf)) {
        showMsg("error", BAD_PDF);
        return;
      }
      state.bytes = buf;
      state.name = file.name;
      fileName.textContent = file.name;
      fileSize.textContent = formatBytes(file.size);
      dz.hidden = true;
      fileRow.hidden = false;
      onFile();
    });
  }

  async function run(payload, text) {
    busy(true);
    showMsg("info", text, true);
    const sent = state.bytes.slice(0);
    let r;
    try {
      r = await runner.run({ bytes: sent, password: state.password, ...payload }, [sent], (p) => showMsg("info", p, true));
    } catch {
      busy(false);
      showMsg("error", ENGINE_CRASHED);
      return null;
    }
    busy(false);
    if (r.ok && password) password.form.hidden = true;
    return r;
  }

  function fail(r, damagedText = damaged("read")) {
    if (r.fatal) {
      showMsg("error", ENGINE_FAILED);
    } else if (r.needsPassword && password) {
      hideMsg();
      password.form.hidden = false;
      password.input.focus();
    } else if (r.wrongPassword && password) {
      state.password = "";
      showMsg("error", WRONG_PASSWORD);
      password.input.focus();
      password.input.select();
    } else {
      showMsg("error", damagedText);
    }
  }

  function showResult(outBytes, suffix) {
    clearResult();
    url = URL.createObjectURL(new Blob([outBytes], { type: "application/pdf" }));
    downloadBtn.href = url;
    downloadBtn.download = downloadName(state.name, suffix, "pdf");
    statBefore.textContent = formatBytes(state.bytes.byteLength);
    statAfter.textContent = formatBytes(outBytes.byteLength);
    hideMsg();
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  bindDropzone(dz, fileInput, (files) => pick(files[0]));
  initPasswordToggles();

  clearBtn.addEventListener("click", () => {
    reset();
    fileRow.hidden = true;
    dz.hidden = false;
  });

  anotherBtn.addEventListener("click", () => {
    clearBtn.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if (password) {
    password.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!password.input.value || !state.bytes) return;
      state.password = password.input.value;
      onUnlock();
    });
  }

  return {
    get bytes() {
      return state.bytes;
    },
    get password() {
      return state.password;
    },
    run,
    fail,
    showResult,
    clearResult,
    showMsg,
    hideMsg,
  };
}
