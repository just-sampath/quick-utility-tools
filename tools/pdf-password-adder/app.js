import { initTheme } from "../../assets/js/common.js";
import { createPdfFileTool } from "../../core/pdf/single-file.js";

initTheme(document.querySelector(".theme-toggle"));

const form = document.getElementById("passwordBlock");
const pwInput = document.getElementById("passwordInput");
const confirmInput = document.getElementById("confirmInput");
const ownerInput = document.getElementById("ownerInput");
const ownerLabel = document.getElementById("ownerLabel");
const msg = document.getElementById("msg");
const protectBtn = document.getElementById("protectBtn");
const statPerms = document.getElementById("statPerms");
const allow = {
  print: document.getElementById("allowPrint"),
  copy: document.getElementById("allowCopy"),
  edit: document.getElementById("allowEdit"),
};

const fields = [pwInput, confirmInput, ownerInput];
const BLOCKED_NAMES = { print: "printing", copy: "copying", edit: "editing" };

const tool = createPdfFileTool({
  worker: "./encrypt-worker.js",
  onFile: checkFile,
  onReset: () => {
    clearFields();
    form.hidden = true;
  },
  onBusy: (on) => {
    protectBtn.disabled = on;
  },
});

function permissions() {
  return { print: allow.print.checked, copy: allow.copy.checked, edit: allow.edit.checked };
}

function blockedText(perms) {
  const blocked = Object.keys(BLOCKED_NAMES).filter((k) => !perms[k]).map((k) => BLOCKED_NAMES[k]);
  if (!blocked.length) return "None";
  const list = blocked.length > 1 ? blocked.slice(0, -1).join(", ") + " and " + blocked.at(-1) : blocked[0];
  return list.charAt(0).toUpperCase() + list.slice(1) + " blocked";
}

function syncOwnerLabel() {
  const restricted = Object.values(permissions()).includes(false);
  ownerLabel.textContent = restricted ? "Owner password (required for restrictions)" : "Owner password (optional)";
}

function clearFields() {
  for (const f of fields) {
    f.value = "";
    f.type = "password";
  }
  for (const btn of form.querySelectorAll("[data-password-toggle]")) {
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", "Show password");
  }
  for (const box of Object.values(allow)) box.checked = true;
  syncOwnerLabel();
}

function showAlreadyEncrypted() {
  form.hidden = true;
  tool.showMsg("error", "This PDF is already password protected. Remove the password first with ");
  const link = document.createElement("a");
  link.href = "../pdf-password-remover/index.html";
  link.textContent = "PDF Password Remover";
  msg.lastElementChild.append(link, ".");
}

async function checkFile() {
  const r = await tool.run({ op: "check" }, "Checking your PDF…");
  if (!r) return;
  if (r.alreadyEncrypted) {
    showAlreadyEncrypted();
    return;
  }
  if (!r.ok) {
    tool.fail(r);
    return;
  }
  tool.hideMsg();
  form.hidden = false;
  pwInput.focus();
}

async function protect(password, ownerPassword, perms) {
  const r = await tool.run({ password, ownerPassword, permissions: perms }, "Encrypting…");
  if (!r) return;
  if (r.ok) {
    statPerms.textContent = blockedText(perms);
    form.hidden = true;
    clearFields();
    tool.showResult(r.bytes, "_protected");
  } else if (r.alreadyEncrypted) {
    showAlreadyEncrypted();
  } else {
    tool.fail(r);
  }
}

for (const box of Object.values(allow)) box.addEventListener("change", syncOwnerLabel);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!tool.file) return;
  if (!pwInput.value) {
    tool.showMsg("error", "Enter a password.");
    pwInput.focus();
    return;
  }
  if (pwInput.value !== confirmInput.value) {
    tool.showMsg("error", "The passwords don't match.");
    confirmInput.focus();
    return;
  }
  const perms = permissions();
  const restricted = Object.values(perms).includes(false);
  if (restricted && (!ownerInput.value || ownerInput.value === pwInput.value)) {
    tool.showMsg("error", "To block printing, copying or editing, enter an owner password that differs from the password to open the PDF.");
    ownerInput.focus();
    return;
  }
  protect(pwInput.value, ownerInput.value, perms);
});
