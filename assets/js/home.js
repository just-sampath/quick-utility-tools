import { initTheme } from "./common.js";

initTheme(document.querySelector(".theme-toggle"));

const pills = [...document.querySelectorAll(".filter-pill[data-filter]")];
const searchInput = document.getElementById("toolSearch");
const emptyEl = document.getElementById("toolEmpty");
const emptyReset = document.getElementById("toolEmptyReset");
const sections = [...document.querySelectorAll(".tool-section[data-category]")].map((el) => ({
  el,
  category: el.dataset.category,
  countEl: el.querySelector(".section-count"),
  cards: [...el.querySelectorAll(".card")].map((card) => ({
    el: card,
    haystack: [
      card.querySelector("h3")?.textContent || "",
      card.querySelector("p")?.textContent || "",
      card.dataset.keywords || "",
    ]
      .join(" ")
      .toLowerCase(),
  })),
}));

let activeFilter = "all";

function applyFilters() {
  const terms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let totalVisible = 0;

  for (const section of sections) {
    const categoryMatch = activeFilter === "all" || section.category === activeFilter;
    let visibleInSection = 0;

    for (const card of section.cards) {
      const matches = categoryMatch && terms.every((term) => card.haystack.includes(term));
      card.el.hidden = !matches;
      if (matches) visibleInSection++;
    }

    section.el.hidden = visibleInSection === 0;
    if (section.countEl) section.countEl.textContent = String(visibleInSection);
    totalVisible += visibleInSection;
  }

  emptyEl.hidden = totalVisible > 0;
}

function setFilter(next) {
  activeFilter = next;
  for (const pill of pills) {
    pill.setAttribute("aria-pressed", String(pill.dataset.filter === activeFilter));
  }
  applyFilters();
}

for (const pill of pills) {
  pill.addEventListener("click", () => setFilter(pill.dataset.filter));
}

searchInput.addEventListener("input", applyFilters);

emptyReset?.addEventListener("click", () => {
  searchInput.value = "";
  setFilter("all");
  searchInput.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const active = document.activeElement;
    const tag = active?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active?.isContentEditable) return;
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if (e.key === "Escape" && document.activeElement === searchInput) {
    if (searchInput.value) {
      searchInput.value = "";
      applyFilters();
    } else {
      searchInput.blur();
    }
  }
});
