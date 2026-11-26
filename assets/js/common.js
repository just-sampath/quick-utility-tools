function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = bg;
}

function syncThemeButton(button) {
  const label = document.documentElement.dataset.theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  button.setAttribute("aria-label", label);
  button.title = label;
}

export function initTheme(button) {
  syncThemeColor();
  syncThemeButton(button);
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    syncThemeColor();
    syncThemeButton(button);
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
    e.stopPropagation();
    dz.classList.remove("dragover");
    if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]);
  });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  input.addEventListener("change", () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = "";
  });
}

function hasDraggedFiles(e) {
  const dt = e.dataTransfer;
  if (!dt) return false;
  return Array.from(dt.types || []).includes("Files") || Boolean(dt.files?.length);
}

export function bindWorkspaceDrop(target, onFiles, canAccept = () => true) {
  let depth = 0;
  const clear = () => {
    depth = 0;
    target.classList.remove("drop-active");
  };
  target.addEventListener("dragenter", (e) => {
    if (!hasDraggedFiles(e) || !canAccept()) return;
    e.preventDefault();
    depth++;
    target.classList.add("drop-active");
  });
  target.addEventListener("dragover", (e) => {
    if (!hasDraggedFiles(e) || !canAccept()) return;
    e.preventDefault();
    target.classList.add("drop-active");
  });
  target.addEventListener("dragleave", () => {
    if (depth > 0 && --depth === 0) target.classList.remove("drop-active");
  });
  target.addEventListener("drop", (e) => {
    clear();
    if (!canAccept() || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    onFiles([...e.dataTransfer.files]);
  });
  window.addEventListener("drop", clear, true);
  window.addEventListener("dragend", clear);
}

export function initPasswordToggles(root = document) {
  for (const btn of root.querySelectorAll("button[data-password-toggle]")) {
    if (btn.dataset.pwBound === "1") continue;
    const id = btn.getAttribute("aria-controls");
    const input = (id && document.getElementById(id)) || btn.closest(".password-wrap")?.querySelector("input");
    if (!input) continue;
    btn.dataset.pwBound = "1";
    const sync = () => {
      const shown = input.type === "text";
      btn.setAttribute("aria-pressed", String(shown));
      btn.setAttribute("aria-label", shown ? "Hide password" : "Show password");
    };
    sync();
    btn.addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
      sync();
    });
  }
}

export function bindRangeSync(rangeEl, numberEl, onChange = () => {}) {
  const clamp = (n) => {
    const min = rangeEl.min !== "" ? Number(rangeEl.min) : -Infinity;
    const max = rangeEl.max !== "" ? Number(rangeEl.max) : Infinity;
    return Math.min(max, Math.max(min, n));
  };
  rangeEl.addEventListener("input", () => {
    numberEl.value = rangeEl.value;
    onChange();
  });
  numberEl.addEventListener("input", () => {
    const n = parseFloat(numberEl.value);
    if (!Number.isFinite(n)) return;
    rangeEl.value = String(clamp(n));
    onChange();
  });
  numberEl.addEventListener("change", () => {
    const n = parseFloat(numberEl.value);
    if (!Number.isFinite(n)) {
      numberEl.value = rangeEl.value;
      onChange();
      return;
    }
    const v = clamp(n);
    numberEl.value = String(v);
    rangeEl.value = String(v);
    onChange();
  });
}

export function moveItem(list, item, delta) {
  const i = list.indexOf(item);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
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
      if (jobs.size && worker) {
        worker.terminate();
        worker = null;
      }
      jobs.clear();
    },
  };
}
