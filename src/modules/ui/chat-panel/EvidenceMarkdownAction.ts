import type { EvidenceRecord } from "../../../types/evidence";
import { getString } from "../../../utils/locale";
import type { MarkdownRenderOptions } from "./MarkdownRenderer";
import { navigateToPdfQuote } from "./PdfQuoteNavigator";
import { openSourceTarget, type SourceTarget } from "./SourceNavigator";

function getItemByLibraryKey(
  itemKey: string,
  libraryID?: number,
): Zotero.Item | null {
  const resolvedLibraryID = libraryID ?? Zotero.Libraries?.userLibraryID;
  if (!Number.isSafeInteger(resolvedLibraryID)) {
    return null;
  }
  return (
    (Zotero.Items.getByLibraryAndKey(resolvedLibraryID, itemKey) as
      | Zotero.Item
      | false) || null
  );
}

export function createEvidenceMarkdownAction(
  options: { onError?: (error: Error) => void } = {},
): NonNullable<MarkdownRenderOptions["evidenceAction"]> {
  return {
    citationTitle: getString("chat-evidence-citation-title"),
    viewSourceLabel: getString("chat-evidence-view-source"),
    onClick: async (record: EvidenceRecord) => {
      const target: SourceTarget = {
        type: "item",
        key: record.itemKey,
        libraryID: record.libraryID,
        page: record.page,
      };
      const sourceItem = getItemByLibraryKey(record.itemKey, record.libraryID);
      if (!sourceItem) {
        await openSourceTarget(target);
        return;
      }
      const navigated = await navigateToPdfQuote(record.quote, sourceItem, {
        allowActiveReaderFallback: false,
        fallbackPageIndex: record.page ? record.page - 1 : undefined,
      });
      if (!navigated) {
        await openSourceTarget(target);
      }
    },
    onError: (error) => {
      ztoolkit.log("[Evidence] Failed to open evidence source:", error);
      options.onError?.(error);
    },
  };
}
