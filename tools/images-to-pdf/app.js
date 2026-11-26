import { initTheme, formatBytes, createJobRunner, createStatus, bindDropzone } from "../../assets/js/common.js";

initTheme(document.querySelector(".theme-toggle"));

const dz = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const options = document.getElementById("options");
const pageSelect = document.getElementById("pageSelect");
const marginSelect = document.getElementById("marginSelect");
const convertBtn = document.getElementById("convertBtn");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const result = document.getElementById("result");
const statCount = document.getElementById("statCount");
const statSize = document.getElementById("statSize");
const statBefore = document.getElementById("statBefore");
const resultFlag = document.getElementById("resultFlag");
const pdfBtn = document.getElementById("pdfBtn");
const template = document.getElementById("itemTemplate");

const runner = createJobRunner("./convert-worker.js", "module");
const { showMsg, hideMsg } = createStatus(document.getElementById("msg"));

const ERRORS = {
  decode: "Couldn't read this image.",
  avif: "This browser can't open AVIF images.",
  heic: "Couldn't read this HEIC image.",
  none: "None of the images could be read.",
  crashed: "Ran out of memory. Try fewer or smaller images.",
};

let items = [];
let pdfUrl = null;
let busy = false;

function resetResult() {
  result.hidden = true;
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
}

function render() {
  fileList.replaceChildren();
  items.forEach((item, i) => {
    const li = template.content.firstElementChild.cloneNode(true);
    li.querySelector(".file-name").textContent = `${i + 1}. ${item.file.name}`;
    const size = li.querySelector(".file-size");
    size.textContent = formatBytes(item.file.size);
    if (item.error) {
      li.classList.add("is-error");
      size.textContent = ERRORS[item.error] || ERRORS.decode;
    }
    const [up, down] = li.querySelectorAll("[data-move]");
    up.disabled = i === 0 || busy;
    down.disabled = i === items.length - 1 || busy;
    up.addEventListener("click", () => move(item, -1));
    down.addEventListener("click", () => move(item, 1));
    const remove = li.querySelector("[data-remove]");
    remove.disabled = busy;
    remove.addEventListener("click", () => {
      items = items.filter((x) => x !== item);
      changed();
    });
    fileList.append(li);
  });
  fileList.hidden = !items.length;
  options.hidden = !items.length;
  convertBtn.disabled = busy || !items.length;
  addBtn.disabled = busy;
  clearBtn.disabled = busy;
  fileInput.disabled = busy;
}

function move(item, delta) {
  const i = items.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  changed();
}

function changed() {
  resetResult();
  hideMsg();
  render();
}

function addFiles(files) {
  if (busy) return;
  const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name));
  if (images.length < files.length) showMsg("error", "Some files were skipped because they aren't images.");
  else hideMsg();
  items.push(...images.map((file) => ({ file, error: null })));
  resetResult();
  render();
}

async function convert() {
  busy = true;
  resetResult();
  for (const item of items) item.error = null;
  render();
  showMsg("info", "Creating PDF…", true);
  try {
    const reply = await runner.run(
      { files: items.map((i) => i.file), settings: { page: pageSelect.value, margin: Number(marginSelect.value) } },
      [],
      (text) => showMsg("info", text, true),
    );
    if (reply.error) {
      showMsg("error", ERRORS[reply.error] || ERRORS.crashed);
      return;
    }
    const failed = new Set(reply.skipped.map((s) => s.index));
    for (const s of reply.skipped) items[s.index].error = s.code;
    hideMsg();
    pdfUrl = URL.createObjectURL(reply.blob);
    pdfBtn.href = pdfUrl;
    pdfBtn.download = "images.pdf";
    statCount.textContent = String(reply.pages);
    statSize.textContent = formatBytes(reply.blob.size);
    const before = items.filter((_, i) => !failed.has(i)).reduce((sum, i) => sum + i.file.size, 0);
    statBefore.textContent = formatBytes(before);
    const flags = [];
    if (failed.size) flags.push(`${failed.size} image${failed.size > 1 ? "s" : ""} couldn't be read and ${failed.size > 1 ? "were" : "was"} left out.`);
    if (reply.notes.includes("scaled")) flags.push("Some images over 16.7 megapixels were scaled down.");
    if (reply.blob.size > before) flags.push("The PDF is larger than the original images combined.");
    resultFlag.textContent = flags.join(" ");
    resultFlag.hidden = !flags.length;
    result.hidden = false;
  } catch {
    showMsg("error", ERRORS.crashed);
  } finally {
    busy = false;
    render();
  }
}

bindDropzone(dz, fileInput, addFiles);
addBtn.addEventListener("click", () => fileInput.click());
clearBtn.addEventListener("click", () => {
  items = [];
  changed();
});
convertBtn.addEventListener("click", convert);
pageSelect.addEventListener("change", resetResult);
marginSelect.addEventListener("change", resetResult);
render();
