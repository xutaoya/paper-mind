import { getPref } from "../../utils/prefs";
import { getZoteroItem, isZoteroItemAlive } from "../../utils/zoteroItems";
import {
  buildMineruCacheKey,
  getMinerUCacheService,
} from "./MinerUCacheService";
import {
  getMineruApiToken,
  parsePdfAttachmentWithMinerU,
} from "./MinerUParser";

const AUTO_CACHE_DELAY_MS = 8000;
const NOTIFIER_ID = "paperchat-mineru-auto-cache";

export function isMineruAutoCacheOnImportEnabled(): boolean {
  return getPref("mineruAutoCacheOnImport") === true;
}

export function isMineruAutoCacheReady(): boolean {
  return isMineruAutoCacheOnImportEnabled() && getMineruApiToken().length > 0;
}

export function collectPdfAttachmentsFromAddedItem(
  itemID: number,
): Zotero.Item[] {
  const item = getZoteroItem(itemID);
  if (!item || item.isNote?.()) {
    return [];
  }

  const attachments: Zotero.Item[] = [];
  const seen = new Set<string>();

  const addAttachment = (attachment: Zotero.Item | null | false): void => {
    if (!isZoteroItemAlive(attachment) || !attachment.isPDFAttachment?.()) {
      return;
    }
    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);
    if (seen.has(cacheKey)) {
      return;
    }
    seen.add(cacheKey);
    attachments.push(attachment);
  };

  if (item.isPDFAttachment?.()) {
    addAttachment(item);
    return attachments;
  }

  if (item.isAttachment?.()) {
    return attachments;
  }

  try {
    for (const attachmentID of item.getAttachments?.() ?? []) {
      addAttachment(getZoteroItem(attachmentID));
    }
  } catch (error) {
    ztoolkit.log(
      "[MinerUAutoCache] Failed to read attachments for added item:",
      error,
    );
  }

  return attachments;
}

class MinerUAutoCacheService {
  private notifierID: string | null = null;
  private readonly pendingTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly queue: Zotero.Item[] = [];
  private processing = false;
  private destroyed = false;

  register(): void {
    if (this.notifierID || this.destroyed) {
      return;
    }

    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: async (
          event: string,
          type: string,
          ids: (string | number)[],
        ) => {
          if (event === "add" && type === "item") {
            await this.handleItemsAdded(ids as number[]);
          }
        },
      },
      ["item"],
      NOTIFIER_ID,
      100,
    );
  }

  unregister(): void {
    this.destroyed = true;
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.queue.length = 0;

    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = null;
    }
  }

  private async handleItemsAdded(ids: number[]): Promise<void> {
    if (!isMineruAutoCacheReady()) {
      return;
    }

    for (const id of ids) {
      for (const attachment of collectPdfAttachmentsFromAddedItem(id)) {
        this.scheduleAttachment(attachment);
      }
    }
  }

  private scheduleAttachment(attachment: Zotero.Item): void {
    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);

    const existingTimer = this.pendingTimers.get(cacheKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(cacheKey);
      if (!isMineruAutoCacheReady()) {
        return;
      }

      const freshAttachment = Zotero.Items.getByLibraryAndKey(
        attachment.libraryID,
        attachment.key,
      );
      if (
        !isZoteroItemAlive(freshAttachment) ||
        !freshAttachment.isPDFAttachment?.()
      ) {
        return;
      }

      void this.enqueue(freshAttachment);
    }, AUTO_CACHE_DELAY_MS);

    this.pendingTimers.set(cacheKey, timer);
  }

  private async enqueue(attachment: Zotero.Item): Promise<void> {
    if (
      this.queue.some(
        (queued) =>
          queued.libraryID === attachment.libraryID &&
          queued.key === attachment.key,
      )
    ) {
      return;
    }

    const cached = await getMinerUCacheService().getCachedMarkdown(attachment);
    if (cached) {
      return;
    }

    this.queue.push(attachment);
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.destroyed) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0 && !this.destroyed) {
        if (!isMineruAutoCacheReady()) {
          this.queue.length = 0;
          break;
        }

        const attachment = this.queue.shift();
        if (!attachment) {
          continue;
        }

        try {
          await parsePdfAttachmentWithMinerU(attachment);
        } catch (error) {
          ztoolkit.log(
            "[MinerUAutoCache] Failed to pre-parse imported attachment:",
            error,
          );
        }
      }
    } finally {
      this.processing = false;
      if (this.queue.length > 0 && !this.destroyed) {
        void this.processQueue();
      }
    }
  }
}

let autoCacheService: MinerUAutoCacheService | null = null;

export function getMinerUAutoCacheService(): MinerUAutoCacheService {
  if (!autoCacheService) {
    autoCacheService = new MinerUAutoCacheService();
  }
  return autoCacheService;
}

export function destroyMinerUAutoCacheService(): void {
  autoCacheService?.unregister();
  autoCacheService = null;
}
