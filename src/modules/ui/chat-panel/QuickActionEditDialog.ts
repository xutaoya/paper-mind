import { getString } from "../../../utils/locale";
import { openZToolkitDialog } from "../../../utils/dialog";
import type { QuickAction } from "../../chat/quick-actions";
import { createQuickActionId } from "../../chat/quick-actions";

export interface QuickActionEditResult {
  saved: boolean;
  deleted?: boolean;
  action?: QuickAction;
}

function readFieldValue(doc: Document, id: string): string {
  const element = doc.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  return element?.value?.trim() || "";
}

export function openQuickActionEditDialog(
  action: QuickAction | null,
): Promise<QuickActionEditResult> {
  return new Promise((resolve) => {
    const mainWindow = Zotero.getMainWindow();
    if (!mainWindow) {
      resolve({ saved: false });
      return;
    }

    let settled = false;
    let savedResult: QuickActionEditResult | null = null;
    const finish = (result: QuickActionEditResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const dialogHelper = new ztoolkit.Dialog(1, 1)
      .addCell(0, 0, {
        tag: "div",
        id: "quick-action-edit-body",
        styles: {
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          padding: "16px",
          minWidth: "420px",
        },
        children: [
          {
            tag: "div",
            styles: { display: "flex", flexDirection: "column", gap: "6px" },
            children: [
              {
                tag: "label",
                properties: {
                  textContent: getString("chat-quick-action-label"),
                },
                attributes: { for: "quick-action-label-input" },
              },
              {
                tag: "input",
                id: "quick-action-label-input",
                properties: {
                  value: action?.label || "",
                },
                attributes: {
                  type: "text",
                },
                styles: {
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border, #d1d5db)",
                },
              },
            ],
          },
          {
            tag: "div",
            styles: {
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              flex: "1",
            },
            children: [
              {
                tag: "label",
                properties: {
                  textContent: getString("chat-quick-action-prompt"),
                },
                attributes: { for: "quick-action-prompt-input" },
              },
              {
                tag: "textarea",
                id: "quick-action-prompt-input",
                properties: {
                  value: action?.prompt || "",
                },
                styles: {
                  minHeight: "160px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border, #d1d5db)",
                  resize: "vertical",
                  fontFamily: "inherit",
                  lineHeight: "1.5",
                },
              },
            ],
          },
        ],
      })
      .addButton(getString("chat-quick-action-cancel"), "cancel");

    if (action?.id) {
      dialogHelper.addButton(getString("chat-quick-action-delete"), "delete", {
        noClose: true,
        callback: () => {
          const win = dialogHelper.window;
          if (!win) {
            return;
          }
          const confirmed = Services.prompt.confirm(
            win as unknown as mozIDOMWindowProxy,
            getString("chat-quick-action-delete"),
            getString("chat-quick-action-delete-confirm", {
              args: { label: action.label },
            }),
          );
          if (!confirmed) {
            return;
          }
          savedResult = { saved: false, deleted: true };
          finish(savedResult);
          win.close();
        },
      });
    }

    dialogHelper.addButton(getString("chat-quick-action-save"), "save", {
      noClose: true,
      callback: () => {
        const doc = dialogHelper.window?.document;
        if (!doc) {
          return;
        }
        const label = readFieldValue(doc, "quick-action-label-input");
        const prompt = readFieldValue(doc, "quick-action-prompt-input");
        if (!label || !prompt) {
          Services.prompt.alert(
            dialogHelper.window as unknown as mozIDOMWindowProxy,
            getString("chat-quick-action-edit-title"),
            getString("chat-quick-action-invalid"),
          );
          return;
        }
        savedResult = {
          saved: true,
          action: {
            id: action?.id || createQuickActionId(label),
            label,
            prompt,
          },
        };
        finish(savedResult);
        dialogHelper.window?.close();
      },
    });

    openZToolkitDialog(
      dialogHelper,
      mainWindow,
      getString("chat-quick-action-edit-title"),
      {
        resizable: true,
        centerscreen: true,
        fitContent: true,
      },
    );

    const dialogWin = dialogHelper.window;
    if (!dialogWin) {
      finish({ saved: false });
      return;
    }

    dialogWin.addEventListener("dialogcancel", () => {
      if (savedResult?.saved || savedResult?.deleted) {
        return;
      }
      finish({ saved: false });
    });
  });
}
