/**
 * ReaderChatEntry - "Ask in chat" entry points inside the PDF reader.
 *
 * Two surfaces:
 * - renderTextSelectionPopup: a button in the reader's text-selection popup
 *   that sends the highlighted passage to the chat panel.
 * - createAnnotationContextMenu: a menu entry on saved annotations that sends
 *   the annotation text (and its comment) to the chat panel.
 *
 * Both seed the pending selected-text attachment and open the panel, so the
 * user lands in chat with the passage already attached.
 *
 * Reader listeners are registered globally per addonRef (not per window), so
 * registration is idempotent and torn down at shutdown.
 */

import { getString } from "../../utils/locale";
import { addSelectedTextAttachment, showPanel } from "./chat-panel";
import type { ChatPanelOpenSource } from "./chat-panel/ChatPanelManager";
import {
  collectAnnotationText,
  type ReaderLike,
} from "./reader-chat-selection";

type SelectionPopupEvent = {
  doc: Document;
  params: { annotation?: { text?: string } };
  append: (...nodes: Array<Node | string>) => void;
  reader: ReaderLike;
};

type AnnotationMenuEvent = {
  params: { ids?: string[] };
  append: (options: { label: string; onCommand: () => void }) => void;
  reader: ReaderLike;
};

const READER_ASK_STYLES = `
  .paperchat-reader-ask-row {
    flex: 1 1 100%;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding: 5px 0 0;
    margin-top: 4px;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
  }
  .paperchat-reader-ask-row > .paperchat-reader-ask-button {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    height: auto;
    min-height: 34px;
    max-height: none;
    box-sizing: border-box;
    margin: 0;
    padding: 4px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    text-align: start;
    cursor: pointer;
  }
  .paperchat-reader-ask-row > .paperchat-reader-ask-button:hover {
    background: rgba(128, 128, 128, 0.12);
  }
  .paperchat-reader-ask-row > .paperchat-reader-ask-button:active {
    background: rgba(128, 128, 128, 0.2);
  }
  .paperchat-reader-ask-row > .paperchat-reader-ask-button:focus-visible {
    outline: 2px solid #8b7bc8;
    outline-offset: -2px;
  }
  .paperchat-reader-ask-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: rgba(139, 123, 200, 0.12);
    color: #7962b3;
  }
  .paperchat-reader-ask-label {
    flex: 1;
    white-space: nowrap;
  }
  .paperchat-reader-ask-arrow {
    flex: 0 0 auto;
    opacity: 0.45;
  }
  @media (prefers-color-scheme: dark) {
    .paperchat-reader-ask-icon {
      background: rgba(178, 157, 231, 0.16);
      color: #c5b2ef;
    }
  }
`;

let selectionPopupHandler: ((event: SelectionPopupEvent) => void) | undefined;
let annotationMenuHandler: ((event: AnnotationMenuEvent) => void) | undefined;

/** Open the chat panel with `text` already attached as a quoted selection. */
function openChatWithSelection(
  text: string,
  source: ChatPanelOpenSource,
): void {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  // Panel first: showPanel builds the container synchronously, so the
  // attachment preview has somewhere to render.
  showPanel(source);
  addSelectedTextAttachment(trimmed);
}

function buildSelectionPopupButton(
  doc: Document,
  onCommand: () => void,
): HTMLElement {
  const row = doc.createElement("div");
  row.className = "paperchat-reader-ask-row";

  // Keep styles with the appended DOM, including in reader shadow roots.
  const style = doc.createElement("style");
  style.textContent = READER_ASK_STYLES;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "paperchat-reader-ask-button";
  button.title = getString("chat-reader-ask-tooltip");
  button.setAttribute("aria-label", getString("chat-reader-ask-tooltip"));

  const icon = doc.createElement("span");
  icon.className = "paperchat-reader-ask-icon";
  icon.setAttribute("aria-hidden", "true");
  const svgNS = "http://www.w3.org/2000/svg";
  const logo = doc.createElementNS(svgNS, "svg");
  logo.setAttribute("width", "16");
  logo.setAttribute("height", "16");
  logo.setAttribute("viewBox", "0 0 1024 1024");
  logo.setAttribute("fill", "currentColor");
  logo.setAttribute("focusable", "false");
  // Use the same paths as icons/favicon.svg without an external resource load.
  for (const data of [
    "M362.8 553.9c23.5 0 42.6-19.1 42.6-42.6V213.4c0-46.9 38.2-85.1 85.1-85.1s85.1 38.2 85.1 85.1V245c0 23.5 19 42.6 42.6 42.6 23.5 0 42.6-19.1 42.6-42.6v-31.5c0-93.9-76.3-170.2-170.2-170.2s-170.2 76.4-170.2 170.2v297.9c-0.2 23.5 18.8 42.5 42.4 42.5zM660.7 468.8c-23.5 0-42.6 19.1-42.6 42.6v297.9c0 46.9-38.2 85.1-85.1 85.1s-85.1-38.2-85.1-85.1v-31.5c0-23.5-19-42.6-42.6-42.6-23.5 0-42.6 19.1-42.6 42.6v31.5c0 93.9 76.3 170.2 170.2 170.2s170.2-76.4 170.2-170.2V511.4c0.1-23.5-18.9-42.6-42.4-42.6z",
    "M809.6 319.8H511.7c-23.5 0-42.6 19.1-42.6 42.6s19 42.6 42.6 42.6h297.9c46.9 0 85.1 38.2 85.1 85.1s-38.2 85.1-85.1 85.1h-31.5c-23.5 0-42.6 19.1-42.6 42.6s19 42.6 42.6 42.6h31.5c93.9 0 170.2-76.4 170.2-170.2s-76.3-170.4-170.2-170.4zM554.3 660.3c0-23.5-19-42.6-42.6-42.6H213.8c-46.9 0-85.1-38.2-85.1-85.1s38.2-85.1 85.1-85.1h31.5c23.5 0 42.6-19.1 42.6-42.6s-19-42.6-42.6-42.6h-31.5c-93.9 0-170.2 76.4-170.2 170.2s76.3 170.2 170.2 170.2h297.9c23.5 0.2 42.6-18.9 42.6-42.4z",
  ]) {
    const path = doc.createElementNS(svgNS, "path");
    path.setAttribute("d", data);
    logo.appendChild(path);
  }
  icon.appendChild(logo);

  const label = doc.createElement("span");
  label.className = "paperchat-reader-ask-label";
  label.textContent = getString("chat-reader-ask");

  const arrow = doc.createElementNS(svgNS, "svg");
  arrow.setAttribute("class", "paperchat-reader-ask-arrow");
  arrow.setAttribute("width", "12");
  arrow.setAttribute("height", "12");
  arrow.setAttribute("viewBox", "0 0 16 16");
  arrow.setAttribute("fill", "none");
  arrow.setAttribute("stroke", "currentColor");
  arrow.setAttribute("stroke-width", "1.5");
  arrow.setAttribute("stroke-linecap", "round");
  arrow.setAttribute("stroke-linejoin", "round");
  arrow.setAttribute("aria-hidden", "true");
  arrow.setAttribute("focusable", "false");
  const arrowPath = doc.createElementNS(svgNS, "path");
  arrowPath.setAttribute("d", "m6 4 4 4-4 4");
  arrow.appendChild(arrowPath);

  button.append(icon, label, arrow);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onCommand();
  });

  row.append(style, button);
  return row;
}

export function registerReaderChatEntries(): void {
  if (!Zotero.Reader?.registerEventListener) {
    ztoolkit.log(
      "[ReaderChatEntry] Zotero.Reader.registerEventListener not available",
    );
    return;
  }
  if (selectionPopupHandler || annotationMenuHandler) {
    return;
  }

  selectionPopupHandler = (event: SelectionPopupEvent) => {
    const selected = event.params?.annotation?.text || "";
    if (!selected.trim()) {
      return;
    }
    event.append(
      buildSelectionPopupButton(event.doc, () => {
        openChatWithSelection(selected, "reader_selection");
      }),
    );
  };

  annotationMenuHandler = (event: AnnotationMenuEvent) => {
    const text = collectAnnotationText(event.reader, event.params?.ids);
    if (!text) {
      return;
    }
    event.append({
      label: getString("chat-reader-discuss-annotation"),
      onCommand: () => {
        openChatWithSelection(text, "reader_annotation");
      },
    });
  };

  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    selectionPopupHandler as never,
    addon.data.config.addonRef,
  );
  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    annotationMenuHandler as never,
    addon.data.config.addonRef,
  );

  ztoolkit.log("[ReaderChatEntry] Reader chat entries registered");
}

export function unregisterReaderChatEntries(): void {
  if (!Zotero.Reader?.unregisterEventListener) {
    selectionPopupHandler = undefined;
    annotationMenuHandler = undefined;
    return;
  }

  if (selectionPopupHandler) {
    Zotero.Reader.unregisterEventListener(
      "renderTextSelectionPopup",
      selectionPopupHandler as never,
    );
    selectionPopupHandler = undefined;
  }
  if (annotationMenuHandler) {
    Zotero.Reader.unregisterEventListener(
      "createAnnotationContextMenu",
      annotationMenuHandler as never,
    );
    annotationMenuHandler = undefined;
  }

  ztoolkit.log("[ReaderChatEntry] Reader chat entries unregistered");
}
