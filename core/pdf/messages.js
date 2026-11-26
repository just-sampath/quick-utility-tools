export const NOT_PDF = "That doesn't look like a PDF. Please choose a .pdf file.";
export const BAD_PDF = "This file doesn't contain valid PDF data.";
export const ENGINE_CRASHED = "The PDF engine ran out of memory or crashed. Reload the page and try again.";
export const ENGINE_FAILED = "Failed to load the PDF engine. Check your connection and reload the page.";
export const WRONG_PASSWORD = "Incorrect password. Try again.";
export const REPAIR_HINT = "Saving a new copy from another PDF app often fixes this.";

export function damaged(action = "read") {
  return `This PDF couldn't be ${action}. It may be damaged. ${REPAIR_HINT}`;
}
