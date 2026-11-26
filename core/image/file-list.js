import { formatBytes, createJobRunner, createStatus, bindDropzone, bindWorkspaceDrop } from "../../assets/js/common.js";
import { bindZipButton } from "../../assets/js/zip.js";
import { OLD_BROWSER, ZIP_FAILED } from "./messages.js";

export function createFileList({
  action,
  label,
  zipName,
  prepare,
  idleText,
  worker = null,
  needsCanvas = false,
  canRun = () => true,
  isError = () => false,
  setup = () => {},
  summarize = () => {},
  onChange = () => {},
  onClear = () => {},
}) {
  const dz = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const fileListBar = document.getElementById("fileListBar");
  const fileCount = document.getElementById("fileCount");
  const fileList = document.getElementById("fileList");
  const options = document.getElementById("options");
  const addBtn = document.getElementById("addBtn");
  const clearBtn = document.getElementById("clearBtn");
  const result = document.getElementById("result");
  const statBefore = document.getElementById("statBefore");
  const statAfter = document.getElementById("statAfter");
  const singleDownloadBtn = document.getElementById("singleDownloadBtn");
  const zipBtn = document.getElementById("zipBtn");
  const template = document.getElementById("itemTemplate");
  const panel = dz.closest(".panel");

  let items = [];
  let batch = 0;
  let working = false;
  const runner = worker ? createJobRunner(worker, "module") : null;
  const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));
  const zip = bindZipButton(
    zipBtn,
    zipName,
    () => items.filter((i) => i.output).map((i) => i.output),
    () => showMsg("error", ZIP_FAILED),
  );

  function setStatus(item, text, kind = "") {
    item.li.classList.toggle("is-error", kind === "error");
    item.spinner?.remove();
    item.spinner = null;
    if (kind === "busy") {
      item.spinner = document.createElement("span");
      item.spinner.className = "spinner";
      item.spinner.setAttribute("aria-hidden", "true");
      item.li.querySelector(".file-meta").after(item.spinner);
    }
    item.status.textContent = text;
  }

  function setOutput(item, blob, name, extra = {}) {
    item.output = { ...extra, blob, name };
    item.url = URL.createObjectURL(blob);
    item.download.href = item.url;
    item.download.download = name;
    item.download.hidden = false;
  }

  function setSaving(item, text, muted) {
    item.saving.textContent = text;
    item.saving.classList.toggle("is-none", muted);
    item.saving.hidden = false;
  }

  function setFlag(item, text) {
    item.flag.textContent = text;
    item.flag.hidden = !text;
  }

  function clearItemResult(item) {
    item.spinner?.remove();
    item.spinner = null;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
    item.output = null;
    item.saving.hidden = true;
    item.download.hidden = true;
    if (item.flag) item.flag.hidden = true;
    item.li.classList.remove("is-error");
  }

  function hideResult() {
    result.hidden = true;
    singleDownloadBtn.hidden = true;
    singleDownloadBtn.removeAttribute("href");
    singleDownloadBtn.removeAttribute("download");
    zipBtn.hidden = true;
  }

  function refresh() {
    const has = items.length > 0;
    dz.hidden = has;
    fileListBar.hidden = !has;
    fileCount.textContent = `${items.length} ${items.length === 1 ? "image" : "images"}`;
    fileList.hidden = !has;
    options.hidden = !has;
    action.textContent = label(items);
    action.disabled = working || !canRun(items);
    if (!has) hideResult();
    onChange();
  }

  function busy(on) {
    working = on;
    action.disabled = on || !canRun(items);
    addBtn.disabled = on;
    fileInput.disabled = on;
    for (const item of items) item.remove.disabled = on;
  }

  async function addFiles(files) {
    const { entries, message } = await prepare(files);
    for (const entry of entries) {
      const li = template.content.firstElementChild.cloneNode(true);
      const item = {
        ...entry,
        li,
        status: li.querySelector(".file-size"),
        saving: li.querySelector(".saving"),
        download: li.querySelector("a"),
        flag: li.querySelector(".file-flag"),
        remove: li.querySelector("[data-remove]"),
        spinner: null,
        url: null,
        output: null,
      };
      li.querySelector(".file-name").textContent = entry.file.name;
      item.remove.addEventListener("click", () => removeItem(item));
      setup(item);
      setStatus(item, idleText(item), isError(item) ? "error" : "");
      items.push(item);
      fileList.append(li);
    }
    if (message) showMsg("error", message);
    else hideMsg();
    refresh();
  }

  function removeItem(item) {
    clearItemResult(item);
    item.li.remove();
    items = items.filter((i) => i !== item);
    refresh();
    showSummary();
  }

  function showSummary() {
    const done = items.filter((i) => i.output);
    if (!done.length) {
      hideResult();
      return;
    }
    const before = done.reduce((n, i) => n + i.file.size, 0);
    const after = done.reduce((n, i) => n + i.output.blob.size, 0);
    statBefore.textContent = formatBytes(before);
    statAfter.textContent = formatBytes(after);
    summarize(done, before, after);
    zip.reset();
    if (done.length === 1) {
      singleDownloadBtn.href = done[0].url;
      singleDownloadBtn.download = done[0].output.name;
      singleDownloadBtn.hidden = false;
      zipBtn.hidden = true;
    } else {
      singleDownloadBtn.hidden = true;
      singleDownloadBtn.removeAttribute("href");
      singleDownloadBtn.removeAttribute("download");
      zipBtn.hidden = false;
    }
    result.hidden = false;
  }

  async function runEach(targets, process, failText) {
    const id = ++batch;
    busy(true);
    hideMsg();
    hideResult();
    for (const item of targets) {
      clearItemResult(item);
      setStatus(item, "Waiting…");
    }
    for (const item of targets) {
      if (id !== batch) return;
      await process(item, () => id === batch);
      if (id !== batch) return;
    }
    busy(false);
    showSummary();
    if (targets.some((i) => !i.output)) showMsg("error", failText);
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function runWorkers(settings, finish, failText) {
    return runEach(
      [...items],
      async (item, current) => {
        setStatus(item, "Reading…", "busy");
        let r;
        try {
          r = await runner.run({ file: item.file, kind: item.kind, settings }, [], (p) => {
            if (current()) item.status.textContent = p;
          });
        } catch {
          r = { ok: false, error: "crashed" };
        }
        if (current()) finish(item, r);
      },
      failText,
    );
  }

  function clearAll() {
    batch++;
    runner?.cancel();
    for (const item of items) clearItemResult(item);
    items = [];
    fileList.replaceChildren();
    zip.reset();
    onClear();
    busy(false);
    hideMsg();
    refresh();
  }

  if (needsCanvas && typeof OffscreenCanvas === "undefined") {
    showMsg("error", OLD_BROWSER);
    fileInput.disabled = true;
  }

  bindDropzone(dz, fileInput, addFiles);
  bindWorkspaceDrop(panel, addFiles, () => !working && items.length > 0);
  addBtn.addEventListener("click", () => fileInput.click());
  clearBtn.addEventListener("click", clearAll);

  return {
    get items() {
      return items;
    },
    setStatus,
    setOutput,
    setSaving,
    setFlag,
    runEach,
    runWorkers,
    showMsg,
    hideMsg,
  };
}
