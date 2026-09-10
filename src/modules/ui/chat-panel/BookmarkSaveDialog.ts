import { config } from "../../../../package.json";
import { getBookmarkService } from "../../bookmarks";
import type { BookmarkFolder } from "../../../types/bookmark";
import { getString } from "../../../utils/locale";
import { createElement } from "./ChatPanelBuilder";
import {
  createBookmarkDialogButton,
  createFolderLabel,
  openBookmarkTextPrompt,
  showBookmarkError,
} from "./BookmarkUiPrompts";
import type { ThemeColors } from "./types";
import { HTML_NS } from "./types";

export interface BookmarkSaveDialogInput {
  defaultTitle: string;
  content: string;
  sessionId: string;
  messageId: string;
  itemKey?: string | null;
  itemLibraryId?: number | null;
}

export interface BookmarkSaveDialogResult {
  bookmarkId: string;
  title: string;
}

export async function openBookmarkSaveDialog(
  doc: Document,
  theme: ThemeColors,
  input: BookmarkSaveDialogInput,
): Promise<BookmarkSaveDialogResult | null> {
  const service = getBookmarkService();
  const folders = await service.listFolders();
  let selectedFolderId: string | null = folders[0]?.id ?? null;

  return new Promise((resolve) => {
    const overlay = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    overlay.className = "paperchat-bookmark-dialog-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(15, 23, 42, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: "2147483646",
      padding: "24px",
    });

    const dialog = doc.createElementNS(HTML_NS, "div") as HTMLElement;
    dialog.className = "paperchat-bookmark-dialog";
    Object.assign(dialog.style, {
      width: "min(420px, 100%)",
      background: theme.dropdownBg,
      color: theme.textPrimary,
      borderRadius: "16px",
      boxShadow: "0 20px 60px rgba(15, 23, 42, 0.25)",
      border: `1px solid ${theme.borderColor}`,
      overflow: "hidden",
    });

    const header = createElement(doc, "div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 18px 8px",
      fontSize: "16px",
      fontWeight: "600",
    });
    header.textContent = getString("chat-bookmark-save-title");

    const closeBtn = createElement(
      doc,
      "button",
      {
        border: "none",
        background: "transparent",
        color: theme.textMuted,
        fontSize: "20px",
        cursor: "pointer",
        lineHeight: "1",
        padding: "4px",
      },
      { type: "button", "aria-label": getString("chat-bookmark-cancel") },
    );
    closeBtn.textContent = "×";

    const body = createElement(doc, "div", {
      padding: "8px 18px 16px",
      display: "grid",
      gap: "14px",
    });

    const titleLabel = createElement(doc, "label", {
      display: "block",
      fontSize: "13px",
      color: theme.textSecondary,
      marginBottom: "6px",
    });
    titleLabel.textContent = getString("chat-bookmark-field-title");

    const titleInput = doc.createElementNS(
      HTML_NS,
      "input",
    ) as HTMLInputElement;
    titleInput.type = "text";
    titleInput.value = input.defaultTitle;
    Object.assign(titleInput.style, {
      width: "100%",
      boxSizing: "border-box",
      border: `1px solid ${theme.inputBorderColor}`,
      borderRadius: "10px",
      padding: "10px 12px",
      fontSize: "14px",
      background: theme.inputBg,
      color: theme.textPrimary,
      outline: "none",
    });

    const folderSection = createElement(doc, "div", {
      display: "grid",
      gap: "10px",
    });

    const folderHeader = createElement(doc, "div", {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      minHeight: "24px",
    });
    const folderLabel = createElement(doc, "div", {
      fontSize: "13px",
      color: theme.textSecondary,
    });
    folderLabel.textContent = getString("chat-bookmark-field-folder");

    const newFolderBtn = createBookmarkDialogButton(
      doc,
      "+",
      {
        border: "none",
        background: "transparent",
        color: theme.textMuted,
        cursor: "pointer",
        fontSize: "18px",
        lineHeight: "1",
        padding: "0",
        minWidth: "24px",
        width: "24px",
        height: "24px",
        borderRadius: "6px",
      },
      { type: "button", title: getString("chat-bookmark-new-folder") },
    );

    const folderList = createElement(doc, "div", {
      display: "grid",
      gap: "8px",
      maxHeight: "220px",
      overflowY: "auto",
      overflowX: "hidden",
      padding: "4px 2px 2px",
      boxSizing: "border-box",
    });

    const footer = createElement(doc, "div", {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      padding: "12px 18px 16px",
      borderTop: `1px solid ${theme.borderColor}`,
    });

    const cancelBtn = createBookmarkDialogButton(
      doc,
      getString("chat-bookmark-cancel"),
      {
        border: `1px solid ${theme.borderColor}`,
        background: theme.buttonBg,
        color: theme.textPrimary,
        borderRadius: "10px",
        padding: "8px 14px",
        cursor: "pointer",
        fontSize: "13px",
      },
    );

    const saveBtn = createBookmarkDialogButton(
      doc,
      getString("chat-bookmark-save"),
      {
        border: "none",
        background: "#2563eb",
        color: "#fff",
        borderRadius: "10px",
        padding: "8px 16px",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: "600",
      },
    );

    const renderFolders = (items: BookmarkFolder[]) => {
      folderList.textContent = "";
      if (items.length === 0) {
        const empty = createElement(doc, "div", {
          fontSize: "13px",
          color: theme.textMuted,
          padding: "10px 12px",
          border: `1px dashed ${theme.borderColor}`,
          borderRadius: "10px",
        });
        empty.textContent = getString("chat-bookmark-no-folder-hint");
        folderList.appendChild(empty);
        selectedFolderId = null;
        return;
      }
      if (!selectedFolderId || !items.some((folder) => folder.id === selectedFolderId)) {
        selectedFolderId = items[0]?.id ?? null;
      }
      for (const folder of items) {
        const row = createElement(
          doc,
          "button",
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            width: "100%",
            boxSizing: "border-box",
            appearance: "none",
            border:
              folder.id === selectedFolderId
                ? "1px solid #93c5fd"
                : `1px solid ${theme.borderColor}`,
            background:
              folder.id === selectedFolderId ? "#eff6ff" : theme.inputBg,
            borderRadius: "10px",
            padding: "10px 12px",
            cursor: "pointer",
            color: theme.textPrimary,
            fontSize: "14px",
            textAlign: "left",
            minHeight: "44px",
          },
          { type: "button" },
        );
        const left = createFolderLabel(doc, folder.name);
        Object.assign(left.style, {
          flex: "1",
          minWidth: "0",
        });
        const check = createElement(doc, "span", {
          color: folder.id === selectedFolderId ? "#2563eb" : "transparent",
          fontWeight: "700",
          flexShrink: "0",
          width: "16px",
          textAlign: "center",
        });
        check.textContent = "✓";
        row.appendChild(left);
        row.appendChild(check);
        row.addEventListener("click", () => {
          selectedFolderId = folder.id;
          renderFolders(items);
        });
        folderList.appendChild(row);
      }
    };

    const close = (result: BookmarkSaveDialogResult | null) => {
      overlay.remove();
      resolve(result);
    };

    closeBtn.addEventListener("click", () => close(null));
    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(null);
      }
    });
    newFolderBtn.addEventListener("click", async () => {
      const name = await openBookmarkTextPrompt(doc, theme, {
        title: getString("chat-bookmark-new-folder"),
        label: getString("chat-bookmark-new-folder-prompt"),
        confirmLabel: getString("chat-bookmark-save"),
      });
      if (!name) {
        return;
      }
      try {
        const folder = await service.createFolder(name);
        const nextFolders = await service.listFolders();
        selectedFolderId = folder.id;
        renderFolders(nextFolders);
      } catch (error) {
        ztoolkit.log("[BookmarkSaveDialog] create folder failed:", error);
        showBookmarkError(
          doc,
          theme,
          error instanceof Error
            ? error.message
            : getString("chat-bookmark-save-failed"),
        );
      }
    });
    saveBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim() || input.defaultTitle;
      try {
        const bookmark = await service.saveMessageBookmark({
          title,
          content: input.content,
          folderId: selectedFolderId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          itemKey: input.itemKey,
          itemLibraryId: input.itemLibraryId,
        });
        close({ bookmarkId: bookmark.id, title: bookmark.title });
      } catch (error) {
        ztoolkit.log("[BookmarkSaveDialog] save failed:", error);
        showBookmarkError(
          doc,
          theme,
          error instanceof Error
            ? error.message
            : getString("chat-bookmark-save-failed"),
        );
      }
    });

    renderFolders(folders);
    header.appendChild(closeBtn);
    folderHeader.appendChild(folderLabel);
    folderHeader.appendChild(newFolderBtn);
    folderSection.appendChild(folderHeader);
    folderSection.appendChild(folderList);
    body.appendChild(titleLabel);
    body.appendChild(titleInput);
    body.appendChild(folderSection);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    overlay.appendChild(dialog);
    doc.documentElement.appendChild(overlay);
    titleInput.focus();
    titleInput.select();
  });
}

export function getBookmarkIconUrl(): string {
  return `chrome://${config.addonRef}/content/icons/bookmark.svg`;
}
