export const PREFERENCES_SECTION_IDS = [
  "models",
  "pdf",
  "web-search",
  "ui",
  "ai-tools",
  "skills",
  "aisummary",
] as const;

export type PreferencesSectionId = (typeof PREFERENCES_SECTION_IDS)[number];

const DEFAULT_SECTION: PreferencesSectionId = "models";
const LAST_SECTION_STORAGE_KEY = "paperchat.prefs.lastSection";

const PREFERENCES_SECTION_ID_SET = new Set<string>(PREFERENCES_SECTION_IDS);

function isPreferencesSectionId(
  value: string | null,
): value is PreferencesSectionId {
  return !!value && PREFERENCES_SECTION_ID_SET.has(value);
}

function getStoredSection(doc: Document): PreferencesSectionId | null {
  try {
    const stored =
      doc.defaultView?.sessionStorage.getItem(LAST_SECTION_STORAGE_KEY) ?? null;
    return isPreferencesSectionId(stored) ? stored : null;
  } catch {
    return null;
  }
}

function storeSection(doc: Document, sectionId: PreferencesSectionId): void {
  try {
    doc.defaultView?.sessionStorage.setItem(
      LAST_SECTION_STORAGE_KEY,
      sectionId,
    );
  } catch {
    // Ignore storage failures in restricted contexts.
  }
}

function asHtmlElement(node: Node | null | undefined): HTMLElement | null {
  if (!node) {
    return null;
  }
  const element = node as HTMLElement;
  return typeof element.getAttribute === "function" ? element : null;
}

export function showPreferencesSection(
  doc: Document,
  sectionId: PreferencesSectionId,
): void {
  const nav = doc.getElementById("pref-section-nav");
  const panels = doc.getElementById("pref-section-panels");
  if (!nav || !panels) {
    return;
  }

  for (const node of Array.from(nav.querySelectorAll("[data-pref-section]"))) {
    const button = asHtmlElement(node);
    if (!button) {
      continue;
    }
    const id = button.getAttribute("data-pref-section");
    const active = id === sectionId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  }

  for (const node of Array.from(
    panels.querySelectorAll(".paperchat-prefs-panel"),
  )) {
    const panel = asHtmlElement(node);
    if (!panel) {
      continue;
    }
    const id = panel.getAttribute("data-pref-section");
    const active = id === sectionId;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  }

  storeSection(doc, sectionId);
}

export function bindPreferencesSectionNav(doc: Document): void {
  const nav = doc.getElementById("pref-section-nav");
  if (!nav || nav.getAttribute("data-bound") === "true") {
    return;
  }
  nav.setAttribute("data-bound", "true");

  nav.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest(
      "[data-pref-section]",
    );
    if (!target || !nav.contains(target)) {
      return;
    }

    const sectionId = target.getAttribute("data-pref-section");
    if (!isPreferencesSectionId(sectionId)) {
      return;
    }

    event.preventDefault();
    showPreferencesSection(doc, sectionId);
  });

  showPreferencesSection(doc, getStoredSection(doc) ?? DEFAULT_SECTION);
}
