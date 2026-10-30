export function initTheme(button) {
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  });
}

export function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

const ICONS = {
  spinner: '<span class="spinner" aria-hidden="true"></span>',
  error:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>',
  info: "",
};

export function createStatus(el) {
  return {
    showMsg(kind, text, withSpinner = false) {
      el.className = "msg msg-" + kind;
      el.innerHTML = (withSpinner ? ICONS.spinner : ICONS[kind] || "") + "<span></span>";
      el.lastElementChild.textContent = text;
      el.hidden = false;
    },
    hideMsg() {
      el.hidden = true;
      el.innerHTML = "";
    },
  };
}

export function bindDropzone(dz, input, onFiles) {
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("dragover");
  });
  dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("dragover");
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  input.addEventListener("change", () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = "";
  });
}

export function looksLikePdf(buf) {
  return new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength))).includes("%PDF-");
}

export function downloadName(name, suffix, ext) {
  return name.replace(/\.[^./]+$/, "") + suffix + "." + ext;
}

export function createJobRunner(url, type = "classic") {
  let worker = null;
  let nextId = 0;
  const jobs = new Map();

  function getWorker() {
    if (!worker) {
      worker = new Worker(url, { type });
      worker.onmessage = (e) => {
        const job = jobs.get(e.data.id);
        if (!job) return;
        if ("progress" in e.data) {
          job.onProgress?.(e.data.progress);
          return;
        }
        jobs.delete(e.data.id);
        job.resolve(e.data);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        worker.terminate();
        worker = null;
        for (const job of jobs.values()) job.reject(new Error("worker crashed"));
        jobs.clear();
      };
    }
    return worker;
  }

  return {
    run(payload, transfer = [], onProgress) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject, onProgress });
        getWorker().postMessage({ ...payload, id }, transfer);
      });
    },
    cancel() {
      jobs.clear();
    },
  };
}
