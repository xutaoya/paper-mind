import {
  bindExternalPrefLink,
  MINERU_TOKEN_APPLY_URL,
} from "./openExternalPrefLink";
import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";
import { getErrorMessage } from "../../utils/common";
import { testMineruApiToken } from "../chat/MinerUParser";
import { getMinerUCacheService } from "../chat/MinerUCacheService";
import { parsePdfAttachmentWithMinerU } from "../chat/MinerUParser";
import {
  buildCollectionTree,
  buildLibraryRows,
  buildTagSummary,
  listPdfAttachmentsForScope,
  type MineruCollectionNode,
  type MineruLibraryRow,
} from "./MinerULibraryBrowser";

let activeCollectionKey: string | null = null;
let activeTag: string | null = null;
let cacheSearch = "";
let tagFilter = "";
const MINERU_PREFS_BOUND = Symbol("paperchat.mineruPrefsBound");

function statusLabel(status: MineruLibraryRow["runtimeStatus"]): string {
  switch (status) {
    case "ready":
      return getString("pref-mineru-cache-status-ready");
    case "failed":
      return getString("pref-mineru-cache-status-failed");
    case "stale":
      return getString("pref-mineru-cache-status-stale");
    case "missing":
      return getString("pref-mineru-cache-status-missing");
    case "uncached":
      return getString("pref-mineru-cache-status-uncached");
    default:
      return status;
  }
}

function bindMineruButton(
  doc: Document,
  id: string,
  handler: () => void | Promise<void>,
): void {
  const button = doc.getElementById(id);
  if (!button) {
    return;
  }
  const run = () => {
    void handler();
  };
  button.addEventListener("click", (event) => {
    event.preventDefault();
    run();
  });
  button.addEventListener("command", run);
}

export async function initializeMineruPrefsUI(doc: Document): Promise<void> {
  const enableCheckbox = doc.getElementById(
    "pref-mineru-enable-checkbox",
  ) as XUL.Checkbox | null;
  if (enableCheckbox) {
    enableCheckbox.checked = getPref("useMineruOnExtractFailure") as boolean;
  }

  const autoCacheCheckbox = doc.getElementById(
    "pref-mineru-auto-cache-on-import-checkbox",
  ) as XUL.Checkbox | null;
  if (autoCacheCheckbox) {
    autoCacheCheckbox.checked = getPref("mineruAutoCacheOnImport") as boolean;
  }

  const tokenInput = doc.getElementById(
    "pref-mineru-api-token",
  ) as HTMLInputElement | null;
  if (tokenInput) {
    tokenInput.value = String(getPref("mineruApiToken") || "");
  }

  const tagFilterInput = doc.getElementById(
    "pref-mineru-cache-tag-filter",
  ) as HTMLInputElement | null;
  if (tagFilterInput) {
    tagFilterInput.placeholder = getString(
      "pref-mineru-cache-tag-filter",
      "placeholder",
    );
  }
  const searchInput = doc.getElementById(
    "pref-mineru-cache-search",
  ) as HTMLInputElement | null;
  if (searchInput) {
    searchInput.placeholder = getString(
      "pref-mineru-cache-search",
      "placeholder",
    );
  }

  await refreshMineruCacheUI(doc);
}

function createFolderIcon(doc: Document): HTMLElement {
  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "mineru-pref-tree-icon");
  icon.setAttribute("viewBox", "0 0 16 16");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("width", "12");
  icon.setAttribute("height", "12");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M1.5 3.5A1.5 1.5 0 0 1 3 2h3.172a1.5 1.5 0 0 1 1.06.44L8.5 3.72H13a1.5 1.5 0 0 1 1.5 1.5v7.28A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-9z",
  );
  path.setAttribute("fill", "currentColor");
  icon.appendChild(path);
  return icon as unknown as HTMLElement;
}

function renderCollectionTree(
  doc: Document,
  node: MineruCollectionNode,
  container: HTMLElement,
): void {
  const button = doc.createElement("button");
  button.type = "button";
  button.className =
    activeCollectionKey === node.key
      ? "mineru-pref-tree-item is-active"
      : "mineru-pref-tree-item";
  button.style.paddingLeft = `${8 + node.depth * 14}px`;

  const main = doc.createElement("span");
  main.className = "mineru-pref-tree-main";
  if (node.depth > 0) {
    main.appendChild(createFolderIcon(doc));
  }
  const label = doc.createElement("span");
  label.className = "mineru-pref-tree-label";
  label.textContent = node.name;
  label.title = node.name;
  main.appendChild(label);

  const count = doc.createElement("span");
  count.className = "mineru-pref-tree-count";
  count.textContent = String(node.count);

  button.appendChild(main);
  button.appendChild(count);
  button.addEventListener("click", () => {
    activeCollectionKey = node.key;
    activeTag = null;
    void refreshMineruCacheUI(doc);
  });
  container.appendChild(button);
  for (const child of node.children) {
    renderCollectionTree(doc, child, container);
  }
}

function renderTagList(doc: Document, scopeAttachments: Zotero.Item[]): void {
  const summary = doc.getElementById("pref-mineru-cache-tags-summary");
  const total = doc.getElementById("pref-mineru-cache-tags-total");
  const container = doc.getElementById("pref-mineru-cache-tags");
  if (!summary || !container) {
    return;
  }
  const tagSummary = buildTagSummary(scopeAttachments);
  if (total) {
    total.textContent = String(tagSummary.tagged + tagSummary.untagged);
  }
  summary.textContent = getString("pref-mineru-cache-tags-summary", {
    args: {
      tagged: tagSummary.tagged,
      untagged: tagSummary.untagged,
    },
  });
  container.textContent = "";
  const query = tagFilter.trim().toLowerCase();
  const tags = tagSummary.tags.filter((tag) =>
    !query ? true : tag.name.toLowerCase().includes(query),
  );
  for (const tag of tags) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className =
      activeTag === tag.name
        ? "mineru-pref-tag-item is-active"
        : "mineru-pref-tag-item";
    const marker = doc.createElement("span");
    marker.className = "mineru-pref-tag-marker";
    marker.style.background = tag.color;
    const label = doc.createElement("span");
    label.className = "mineru-pref-tag-label";
    label.textContent = `#${tag.name}`;
    label.title = `#${tag.name}`;
    button.appendChild(marker);
    button.appendChild(label);
    button.addEventListener("click", () => {
      activeTag = activeTag === tag.name ? null : tag.name;
      void refreshMineruCacheUI(doc);
    });
    container.appendChild(button);
  }
  if (tags.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "mineru-pref-tags-empty";
    empty.textContent = getString("pref-mineru-cache-tags-empty");
    container.appendChild(empty);
  }
}

export async function refreshMineruCacheUI(doc: Document): Promise<void> {
  try {
    await renderMineruCacheUI(doc);
  } catch (error) {
    setMineruCacheStatus(doc, getErrorMessage(error), true);
    throw error;
  }
}

async function renderMineruCacheUI(doc: Document): Promise<void> {
  const cacheItems = await getMinerUCacheService().listItems();
  const scopeAttachments =
    await listPdfAttachmentsForScope(activeCollectionKey);
  const rows = buildLibraryRows(scopeAttachments, cacheItems, {
    tag: activeTag,
    search: cacheSearch,
  });
  const readyCount = rows.filter((row) => row.runtimeStatus === "ready").length;

  const summary = doc.getElementById("pref-mineru-cache-summary");
  if (summary) {
    summary.textContent = getString("pref-mineru-cache-summary", {
      args: { ready: readyCount, total: rows.length },
    });
  }

  const progress = doc.getElementById(
    "pref-mineru-cache-progress",
  ) as XUL.ProgressMeter | null;
  if (progress) {
    progress.value = rows.length
      ? Math.round((readyCount / rows.length) * 100)
      : 0;
  }

  const collectionContainer = doc.getElementById(
    "pref-mineru-cache-collections",
  );
  if (collectionContainer) {
    collectionContainer.textContent = "";
    const tree = await buildCollectionTree(
      Zotero.Libraries.userLibraryID,
      getString("pref-mineru-cache-library-root"),
    );
    renderCollectionTree(doc, tree, collectionContainer);
  }

  renderTagList(doc, scopeAttachments);

  const list = doc.getElementById("pref-mineru-cache-list");
  if (!list) {
    return;
  }

  list.textContent = "";
  if (rows.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "mineru-pref-empty";
    empty.textContent = getString("pref-mineru-cache-empty");
    list.appendChild(empty);
    return;
  }

  const table = doc.createElement("table");
  table.className = "mineru-pref-table";

  const header = doc.createElement("thead");
  const headerRow = doc.createElement("tr");

  const selectHeader = doc.createElement("th");
  selectHeader.className = "mineru-pref-col-select";
  const selectAll = doc.createElement("input");
  selectAll.type = "checkbox";
  selectAll.id = "pref-mineru-cache-select-all";
  selectAll.title = getString("pref-mineru-cache-start-selected");
  selectAll.addEventListener("change", () => {
    for (const checkbox of getRowSelectCheckboxes(doc)) {
      checkbox.checked = selectAll.checked;
    }
  });
  selectHeader.appendChild(selectAll);

  const statusHeader = doc.createElement("th");
  statusHeader.className = "mineru-pref-col-status";
  statusHeader.title = getString("pref-mineru-cache-col-status");

  const titleHeader = doc.createElement("th");
  titleHeader.textContent = getString("pref-mineru-cache-col-title");

  const authorHeader = doc.createElement("th");
  authorHeader.className = "mineru-pref-col-author";
  authorHeader.textContent = getString("pref-mineru-cache-col-author");

  const yearHeader = doc.createElement("th");
  yearHeader.className = "mineru-pref-col-year";
  yearHeader.textContent = getString("pref-mineru-cache-col-year");

  const dateHeader = doc.createElement("th");
  dateHeader.className = "mineru-pref-col-date";
  dateHeader.textContent = getString("pref-mineru-cache-col-date-added");

  const actionHeader = doc.createElement("th");
  actionHeader.className = "mineru-pref-col-action";

  headerRow.appendChild(selectHeader);
  headerRow.appendChild(statusHeader);
  headerRow.appendChild(titleHeader);
  headerRow.appendChild(authorHeader);
  headerRow.appendChild(yearHeader);
  headerRow.appendChild(dateHeader);
  headerRow.appendChild(actionHeader);
  header.appendChild(headerRow);
  table.appendChild(header);

  const body = doc.createElement("tbody");
  for (const row of rows) {
    const tableRow = doc.createElement("tr");

    const selectCell = doc.createElement("td");
    selectCell.className = "mineru-pref-col-select";
    const checkbox = doc.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "mineru-cache-row-select";
    checkbox.dataset.cacheKey = row.cacheKey;
    checkbox.disabled = row.runtimeStatus === "missing";
    checkbox.addEventListener("change", () => syncSelectAllState(doc));
    selectCell.appendChild(checkbox);
    tableRow.appendChild(selectCell);

    const statusCell = doc.createElement("td");
    statusCell.className = "mineru-pref-col-status";
    const statusDot = doc.createElement("span");
    statusDot.className = `mineru-pref-status-dot is-${row.runtimeStatus}`;
    statusDot.title = row.errorMessage
      ? `${statusLabel(row.runtimeStatus)}: ${row.errorMessage}`
      : statusLabel(row.runtimeStatus);
    statusCell.appendChild(statusDot);

    const titleCell = doc.createElement("td");
    titleCell.className = "mineru-pref-title-cell";
    const titleText = doc.createElement("div");
    titleText.className = "mineru-pref-title-main";
    titleText.textContent = row.title;
    titleCell.appendChild(titleText);
    if (row.fileName && row.fileName !== row.title) {
      const fileText = doc.createElement("div");
      fileText.className = "mineru-pref-title-sub";
      fileText.textContent = row.fileName;
      titleCell.appendChild(fileText);
    }
    if (row.errorMessage) {
      const errorText = doc.createElement("div");
      errorText.className = "mineru-pref-title-error";
      errorText.textContent = row.errorMessage;
      titleCell.appendChild(errorText);
    }

    const authorCell = doc.createElement("td");
    authorCell.className = "mineru-pref-col-author";
    authorCell.textContent = row.creators;

    const yearCell = doc.createElement("td");
    yearCell.className = "mineru-pref-col-year";
    yearCell.textContent = row.year;

    const dateCell = doc.createElement("td");
    dateCell.className = "mineru-pref-col-date";
    dateCell.textContent = row.dateAdded;

    const actionCell = doc.createElement("td");
    actionCell.className = "mineru-pref-col-action";
    if (row.runtimeStatus !== "uncached" && row.runtimeStatus !== "missing") {
      const deleteBtn = doc.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "mineru-pref-link-danger";
      deleteBtn.textContent = getString("pref-mineru-cache-delete-one");
      deleteBtn.addEventListener("click", async () => {
        await getMinerUCacheService().deleteRecord(row.cacheKey);
        await refreshMineruCacheUI(doc);
      });
      actionCell.appendChild(deleteBtn);
    }

    tableRow.appendChild(statusCell);
    tableRow.appendChild(titleCell);
    tableRow.appendChild(authorCell);
    tableRow.appendChild(yearCell);
    tableRow.appendChild(dateCell);
    tableRow.appendChild(actionCell);
    body.appendChild(tableRow);
  }
  table.appendChild(body);
  list.appendChild(table);
  syncSelectAllState(doc);
}

const ROW_SELECT_SELECTOR = ".mineru-cache-row-select:not(:disabled)";

function isCheckboxInput(node: unknown): node is HTMLInputElement {
  if (!node || typeof node !== "object") {
    return false;
  }
  const element = node as {
    nodeType?: number;
    localName?: string;
    type?: string;
  };
  return (
    element.nodeType === 1 &&
    element.localName === "input" &&
    element.type === "checkbox"
  );
}

function getRowSelectCheckboxes(doc: Document): HTMLInputElement[] {
  return Array.from(doc.querySelectorAll(ROW_SELECT_SELECTOR)).filter(
    isCheckboxInput,
  );
}

function getSelectedCacheKeys(doc: Document): string[] {
  return getRowSelectCheckboxes(doc)
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.dataset.cacheKey)
    .filter((key): key is string => Boolean(key));
}

function syncSelectAllState(doc: Document): void {
  const selectAll = doc.getElementById(
    "pref-mineru-cache-select-all",
  ) as HTMLInputElement | null;
  if (!selectAll) {
    return;
  }
  const boxes = getRowSelectCheckboxes(doc);
  const checkedCount = boxes.filter((box) => box.checked).length;
  selectAll.checked = boxes.length > 0 && checkedCount === boxes.length;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function getMineruParseButtons(doc: Document): HTMLButtonElement[] {
  return [
    "pref-mineru-cache-start-all",
    "pref-mineru-cache-start-selected",
  ].flatMap((id) => {
    const button = doc.getElementById(id) as HTMLButtonElement | null;
    return button ? [button] : [];
  });
}

async function parseMineruAttachments(
  doc: Document,
  attachments: Zotero.Item[],
  emptyMessage: string,
): Promise<void> {
  if (attachments.length === 0) {
    setMineruCacheStatus(doc, emptyMessage);
    return;
  }

  let success = 0;
  let failed = 0;
  for (let index = 0; index < attachments.length; index += 1) {
    const attachment = attachments[index];
    setMineruCacheStatus(
      doc,
      getString("pref-mineru-cache-start-progress", {
        args: {
          current: index + 1,
          total: attachments.length,
          title: attachment.getDisplayTitle(),
        },
      }),
    );
    const markdown = await parsePdfAttachmentWithMinerU(attachment, {
      forceRefresh: true,
    });
    if (markdown) {
      success += 1;
    } else {
      failed += 1;
    }
  }
  setMineruCacheStatus(
    doc,
    getString("pref-mineru-cache-start-done", {
      args: { success, failed },
    }),
    failed > 0,
  );
  await refreshMineruCacheUI(doc);
}

function setMineruCacheStatus(
  doc: Document,
  message: string,
  isError = false,
): void {
  const status = doc.getElementById("pref-mineru-cache-status");
  if (!status) {
    return;
  }
  status.hidden = false;
  status.style.color = isError ? "#c62828" : "#2e7d32";
  status.textContent = message;
}

async function listPendingAttachmentsInScope(): Promise<Zotero.Item[]> {
  const cacheService = getMinerUCacheService();
  const scopeAttachments =
    await listPdfAttachmentsForScope(activeCollectionKey);
  const pending: Zotero.Item[] = [];
  for (const attachment of scopeAttachments) {
    const cached = await cacheService.getCachedMarkdown(attachment);
    if (!cached) {
      pending.push(attachment);
    }
  }
  return pending;
}

export function bindMineruPrefEvents(doc: Document): void {
  if (
    (doc as Document & { [MINERU_PREFS_BOUND]?: boolean })[MINERU_PREFS_BOUND]
  ) {
    return;
  }
  (doc as Document & { [MINERU_PREFS_BOUND]?: boolean })[MINERU_PREFS_BOUND] =
    true;

  bindExternalPrefLink(doc, "pref-mineru-apply-link", MINERU_TOKEN_APPLY_URL);

  const search = doc.getElementById(
    "pref-mineru-cache-search",
  ) as HTMLInputElement | null;
  search?.addEventListener("input", () => {
    cacheSearch = search.value;
    void refreshMineruCacheUI(doc);
  });

  const tagFilterInput = doc.getElementById(
    "pref-mineru-cache-tag-filter",
  ) as HTMLInputElement | null;
  tagFilterInput?.addEventListener("input", () => {
    tagFilter = tagFilterInput.value;
    void refreshMineruCacheUI(doc);
  });

  const enableCheckbox = doc.getElementById(
    "pref-mineru-enable-checkbox",
  ) as XUL.Checkbox | null;
  enableCheckbox?.addEventListener("command", () => {
    setPref("useMineruOnExtractFailure", enableCheckbox.checked);
  });

  const autoCacheCheckbox = doc.getElementById(
    "pref-mineru-auto-cache-on-import-checkbox",
  ) as XUL.Checkbox | null;
  autoCacheCheckbox?.addEventListener("command", () => {
    setPref("mineruAutoCacheOnImport", autoCacheCheckbox.checked);
  });

  const tokenInput = doc.getElementById(
    "pref-mineru-api-token",
  ) as HTMLInputElement | null;
  const persistToken = () => {
    if (tokenInput) {
      setPref("mineruApiToken", tokenInput.value.trim());
    }
  };
  tokenInput?.addEventListener("change", persistToken);
  tokenInput?.addEventListener("blur", persistToken);

  const testBtn = doc.getElementById(
    "pref-mineru-test-btn",
  ) as HTMLButtonElement | null;
  const testResult = doc.getElementById(
    "pref-mineru-test-result",
  ) as HTMLElement | null;
  bindMineruButton(doc, "pref-mineru-test-btn", async () => {
    const token = tokenInput?.value.trim() || "";
    setPref("mineruApiToken", token);
    if (!testBtn || !testResult) {
      return;
    }
    testBtn.disabled = true;
    testResult.hidden = false;
    testResult.style.color = "#666";
    testResult.textContent = getString("pref-mineru-test-running");
    try {
      const result = await testMineruApiToken(token);
      testResult.style.color = result.success ? "#2e7d32" : "#c62828";
      testResult.textContent = result.message;
    } catch (error) {
      testResult.style.color = "#c62828";
      testResult.textContent = getErrorMessage(error);
    } finally {
      testBtn.disabled = false;
    }
  });

  bindMineruButton(doc, "pref-mineru-cache-refresh", () => {
    void refreshMineruCacheUI(doc).catch((error) => {
      setMineruCacheStatus(doc, getErrorMessage(error), true);
    });
  });

  bindMineruButton(doc, "pref-mineru-cache-repair", async () => {
    const removed = await getMinerUCacheService().repairCache();
    setMineruCacheStatus(
      doc,
      getString("pref-mineru-cache-repair-done", {
        args: { count: removed },
      }),
    );
    await refreshMineruCacheUI(doc);
  });

  bindMineruButton(doc, "pref-mineru-cache-delete-all", async () => {
    await getMinerUCacheService().deleteAll();
    setMineruCacheStatus(doc, getString("pref-mineru-cache-delete-all-done"));
    await refreshMineruCacheUI(doc);
  });

  bindMineruButton(doc, "pref-mineru-cache-start-all", async () => {
    const buttons = getMineruParseButtons(doc);
    for (const button of buttons) {
      button.disabled = true;
    }
    try {
      const pending = await listPendingAttachmentsInScope();
      await parseMineruAttachments(
        doc,
        pending,
        getString("pref-mineru-cache-start-none"),
      );
    } catch (error) {
      setMineruCacheStatus(doc, getErrorMessage(error), true);
    } finally {
      for (const button of buttons) {
        button.disabled = false;
      }
    }
  });

  bindMineruButton(doc, "pref-mineru-cache-start-selected", async () => {
    const buttons = getMineruParseButtons(doc);
    for (const button of buttons) {
      button.disabled = true;
    }
    try {
      const selectedKeys = getSelectedCacheKeys(doc);
      const attachments =
        await getMinerUCacheService().getAttachmentsByCacheKeys(selectedKeys);
      await parseMineruAttachments(
        doc,
        attachments,
        getString("pref-mineru-cache-start-selected-none"),
      );
    } catch (error) {
      setMineruCacheStatus(doc, getErrorMessage(error), true);
    } finally {
      for (const button of buttons) {
        button.disabled = false;
      }
    }
  });
}

export async function registerMineruPrefsScripts(
  window: Window,
): Promise<void> {
  const doc = window.document;
  try {
    await initializeMineruPrefsUI(doc);
  } catch (error) {
    setMineruCacheStatus(doc, getErrorMessage(error), true);
    ztoolkit.log("[MinerU Preferences] Failed to initialize:", error);
  }
  try {
    bindMineruPrefEvents(doc);
  } catch (error) {
    ztoolkit.log("[MinerU Preferences] Failed to bind events:", error);
  }
}
