/**
 * ProviderListUI - Provider list and selection
 */

import { getString } from "../../utils/locale";
import { prefColors } from "../../utils/colors";
import { getProviderManager } from "../providers";
import type {
  ProviderConfig,
  ApiKeyProviderConfig,
} from "../../types/provider";
import { clearElement } from "./utils";
import { populateApiKeyPanel } from "./ApiKeyProviderUI";
import { ANALYTICS_EVENTS, getAnalyticsService } from "../analytics";

export function populateProviderList(doc: Document): void {
  const providerManager = getProviderManager();
  const configs = providerManager.getAllConfigs();
  const listContainer = doc.getElementById("pref-provider-list");

  if (!listContainer) return;

  clearElement(listContainer);

  configs
    .filter((config) => config.id !== "paperchat")
    .forEach((config) => {
      const item = createProviderListItem(doc, config);
      listContainer.appendChild(item);
    });
}

function createProviderListItem(
  doc: Document,
  config: ProviderConfig,
): Element {
  const providerManager = getProviderManager();
  const activeProviderId = providerManager.getActiveProviderId();

  const item = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  item.className = "provider-list-item";
  item.setAttribute("data-provider-id", config.id);
  item.style.cssText = `
    padding: 8px 12px;
    margin-bottom: 4px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `;

  const nameSpan = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "span",
  ) as HTMLSpanElement;
  nameSpan.textContent = config.name;
  item.appendChild(nameSpan);

  const statusContainer = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLDivElement;
  statusContainer.style.cssText =
    "display: flex; align-items: center; gap: 4px;";

  const isConfigured = isProviderConfigured(config);
  if (isConfigured) {
    const statusDot = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLSpanElement;
    statusDot.className = "provider-status-dot";
    statusDot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: ${prefColors.statusDot};
      flex-shrink: 0;
    `;
    statusDot.title = getString("pref-provider-configured");
    statusContainer.appendChild(statusDot);
  }

  if (config.id === activeProviderId) {
    const activeCheck = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "span",
    ) as HTMLSpanElement;
    activeCheck.className = "provider-active-check";
    const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("width", "16");
    icon.setAttribute("height", "16");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m3 8 3 3 7-7");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.75");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    icon.appendChild(path);
    activeCheck.appendChild(icon);
    activeCheck.style.cssText = "font-size: 12px; flex-shrink: 0;";
    activeCheck.title = getString("pref-provider-active");
    statusContainer.appendChild(activeCheck);
  }

  item.appendChild(statusContainer);

  item.addEventListener("mouseenter", () => {
    if (item.getAttribute("data-selected") !== "true") {
      item.style.backgroundColor = prefColors.providerItemHover;
    }
  });

  item.addEventListener("mouseleave", () => {
    if (item.getAttribute("data-selected") !== "true") {
      item.style.backgroundColor = "";
    }
  });

  return item;
}

function isProviderConfigured(config: ProviderConfig): boolean {
  const apiKeyConfig = config as ApiKeyProviderConfig;
  return apiKeyConfig.enabled && !!apiKeyConfig.apiKey?.trim();
}

export function selectProvider(
  doc: Document,
  providerId: string,
  setCurrentProviderId: (id: string) => void,
  options: {
    trackAnalytics?: boolean;
    analyticsSource?: string;
  } = {},
): void {
  setCurrentProviderId(providerId);
  const providerManager = getProviderManager();

  const items = doc.querySelectorAll(".provider-list-item");
  items.forEach((item: Element) => {
    const el = item as HTMLElement;
    if (el.getAttribute("data-provider-id") === providerId) {
      el.style.backgroundColor = prefColors.providerItemSelected;
      el.style.color = prefColors.providerItemSelectedText;
      el.setAttribute("data-selected", "true");
    } else {
      el.style.backgroundColor = "";
      el.style.color = "";
      el.setAttribute("data-selected", "false");
    }
  });

  const paperchatPanel = doc.getElementById("pref-panel-paperchat");
  const apikeyPanel = doc.getElementById("pref-panel-apikey");
  paperchatPanel?.setAttribute("hidden", "true");
  apikeyPanel?.removeAttribute("hidden");

  const config = providerManager.getProviderConfig(
    providerId,
  ) as ApiKeyProviderConfig;
  const metadata = providerManager.getProviderMetadata(providerId);

  if (config) {
    populateApiKeyPanel(doc, config, metadata);
  }

  if (options.trackAnalytics) {
    getAnalyticsService().track(ANALYTICS_EVENTS.settingsProviderViewed, {
      provider: providerId,
      source: options.analyticsSource || "unknown",
      low_balance: false,
    });
  }
}

export function populateActiveProviderDropdown(doc: Document): void {
  const providerManager = getProviderManager();
  const configs = providerManager.getAllConfigs();
  const popup = doc.getElementById("pref-active-provider-popup");
  const select = doc.getElementById(
    "pref-active-provider-select",
  ) as unknown as XULMenuListElement;

  if (!popup || !select) return;

  clearElement(popup);

  configs
    .filter((c) => c.enabled && c.id !== "paperchat")
    .forEach((config) => {
      const menuitem = doc.createXULElement("menuitem");
      menuitem.setAttribute("label", config.name);
      menuitem.setAttribute("value", config.id);
      popup.appendChild(menuitem);
    });

  const activeProviderId = providerManager.getActiveProviderId();
  select.value = activeProviderId;
}

export function bindProviderListClickEvents(
  doc: Document,
  setCurrentProviderId: (id: string) => void,
): void {
  const listContainer = doc.getElementById("pref-provider-list");
  if (!listContainer) return;

  listContainer.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest(".provider-list-item") as HTMLElement | null;
    if (!item) return;

    const providerId = item.getAttribute("data-provider-id");
    if (!providerId) return;

    selectProvider(doc, providerId, setCurrentProviderId, {
      trackAnalytics: true,
      analyticsSource: "sidebar_click",
    });
  });
}

export function bindActiveProviderEvent(doc: Document): void {
  const select = doc.getElementById(
    "pref-active-provider-select",
  ) as unknown as XULMenuListElement | null;
  if (!select) return;

  select.addEventListener("command", () => {
    const providerId = select.value;
    if (!providerId) return;
    getProviderManager().setActiveProvider(providerId);
  });
}
