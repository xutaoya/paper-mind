import { getDataPath } from "../../utils/common";
import {
  getParentItem,
  getZoteroItemByKey,
  isZoteroItemAlive,
} from "../../utils/zoteroItems";
import { extractMineruZipToDirectory } from "./MinerUZipArchive";

const CACHE_ROOT = "mineru-cache";
const INDEX_FILE = "index.json";
const ENTRIES_DIR = "entries";

export interface MineruCacheRecord {
  cacheKey: string;
  attachmentKey: string;
  libraryID: number;
  parentItemKey: string | null;
  title: string;
  fileName: string;
  fileSize: number;
  fileMtime: number;
  contentLength: number;
  parsedAt: number;
  status: "ready" | "failed";
  errorMessage?: string;
}

export interface MineruCacheListItem extends MineruCacheRecord {
  runtimeStatus: "ready" | "failed" | "stale" | "missing";
}

type MineruCacheIndex = Record<string, MineruCacheRecord>;

export function buildMineruCacheKey(
  libraryID: number,
  attachmentKey: string,
): string {
  return `${libraryID}_${attachmentKey}`;
}

export function isCacheRecordFresh(
  record: MineruCacheRecord,
  fileSize: number,
  fileMtime: number,
): boolean {
  return (
    record.status === "ready" &&
    record.fileSize === fileSize &&
    record.fileMtime === fileMtime
  );
}

class MinerUCacheService {
  private index: MineruCacheIndex | null = null;

  private getIndexPath(): string {
    return getDataPath(CACHE_ROOT, INDEX_FILE);
  }

  private getLegacyMarkdownPath(cacheKey: string): string {
    return getDataPath(CACHE_ROOT, ENTRIES_DIR, `${cacheKey}.md`);
  }

  private getEntryDir(cacheKey: string): string {
    return getDataPath(CACHE_ROOT, ENTRIES_DIR, cacheKey);
  }

  private getMarkdownPath(cacheKey: string): string {
    return PathUtils.join(this.getEntryDir(cacheKey), "full.md");
  }

  private async resolveMarkdownPath(cacheKey: string): Promise<string | null> {
    const markdownPath = this.getMarkdownPath(cacheKey);
    if (await IOUtils.exists(markdownPath)) {
      return markdownPath;
    }
    const legacyPath = this.getLegacyMarkdownPath(cacheKey);
    if (await IOUtils.exists(legacyPath)) {
      return legacyPath;
    }
    return null;
  }

  private async removeEntryArtifacts(cacheKey: string): Promise<void> {
    const legacyPath = this.getLegacyMarkdownPath(cacheKey);
    if (await IOUtils.exists(legacyPath)) {
      await IOUtils.remove(legacyPath);
    }
    const entryDir = this.getEntryDir(cacheKey);
    if (await IOUtils.exists(entryDir)) {
      await IOUtils.remove(entryDir, { recursive: true });
    }
  }

  private async ensureDirs(): Promise<void> {
    await IOUtils.makeDirectory(getDataPath(CACHE_ROOT), {
      createAncestors: true,
      ignoreExisting: true,
    });
    await IOUtils.makeDirectory(getDataPath(CACHE_ROOT, ENTRIES_DIR), {
      createAncestors: true,
      ignoreExisting: true,
    });
  }

  private async loadIndex(): Promise<MineruCacheIndex> {
    if (this.index) {
      return this.index;
    }
    await this.ensureDirs();
    const indexPath = this.getIndexPath();
    if (!(await IOUtils.exists(indexPath))) {
      this.index = {};
      return this.index;
    }
    try {
      const raw = await IOUtils.readUTF8(indexPath);
      this.index = JSON.parse(raw) as MineruCacheIndex;
      return this.index;
    } catch (error) {
      ztoolkit.log("[MinerUCache] Failed to read index, resetting:", error);
      this.index = {};
      return this.index;
    }
  }

  private async saveIndex(): Promise<void> {
    await this.ensureDirs();
    const index = await this.loadIndex();
    await IOUtils.writeUTF8(
      this.getIndexPath(),
      JSON.stringify(index, null, 2),
    );
  }

  private async getAttachmentFingerprint(
    attachment: Zotero.Item,
  ): Promise<{ fileSize: number; fileMtime: number } | null> {
    if (!isZoteroItemAlive(attachment)) {
      return null;
    }
    try {
      const path = await attachment.getFilePathAsync();
      if (!path || !(await IOUtils.exists(path))) {
        return null;
      }
      const stat = await IOUtils.stat(path);
      return {
        fileSize: Number(stat.size || 0),
        fileMtime: Number(stat.lastModified || 0),
      };
    } catch {
      return null;
    }
  }

  private resolveTitle(attachment: Zotero.Item): string {
    const parent = getParentItem(attachment);
    if (parent) {
      const title = String(parent.getField("title") || "").trim();
      if (title) {
        return title;
      }
    }
    return attachment.attachmentFilename || attachment.getDisplayTitle();
  }

  async getCachedMarkdown(attachment: Zotero.Item): Promise<string | null> {
    const fingerprint = await this.getAttachmentFingerprint(attachment);
    if (!fingerprint) {
      return null;
    }

    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);
    const index = await this.loadIndex();
    const record = index[cacheKey];
    if (
      !record ||
      !isCacheRecordFresh(record, fingerprint.fileSize, fingerprint.fileMtime)
    ) {
      return null;
    }

    const markdownPath = await this.resolveMarkdownPath(cacheKey);
    if (!markdownPath) {
      return null;
    }

    const markdown = (await IOUtils.readUTF8(markdownPath)).trim();
    return markdown || null;
  }

  async saveCachedParseResult(
    attachment: Zotero.Item,
    zipBytes: Uint8Array,
  ): Promise<string | null> {
    const fingerprint = await this.getAttachmentFingerprint(attachment);
    if (!fingerprint) {
      throw new Error("Attachment file is missing");
    }

    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);
    await this.removeEntryArtifacts(cacheKey);
    const entryDir = this.getEntryDir(cacheKey);
    await IOUtils.makeDirectory(entryDir, {
      createAncestors: true,
      ignoreExisting: true,
    });

    const markdown = await extractMineruZipToDirectory(zipBytes, entryDir);
    if (!markdown) {
      await this.removeEntryArtifacts(cacheKey);
      throw new Error("MinerU zip did not contain markdown");
    }

    const index = await this.loadIndex();
    const parent = getParentItem(attachment);

    index[cacheKey] = {
      cacheKey,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      parentItemKey: parent?.key || null,
      title: this.resolveTitle(attachment),
      fileName: attachment.attachmentFilename || "document.pdf",
      fileSize: fingerprint.fileSize,
      fileMtime: fingerprint.fileMtime,
      contentLength: markdown.length,
      parsedAt: Date.now(),
      status: "ready",
    };

    await this.saveIndex();
    return markdown;
  }

  /** @deprecated Use saveCachedParseResult to retain images and other MinerU assets. */
  async saveCachedMarkdown(
    attachment: Zotero.Item,
    markdown: string,
  ): Promise<void> {
    const fingerprint = await this.getAttachmentFingerprint(attachment);
    if (!fingerprint) {
      throw new Error("Attachment file is missing");
    }

    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);
    const index = await this.loadIndex();
    const parent = getParentItem(attachment);

    await this.removeEntryArtifacts(cacheKey);
    const entryDir = this.getEntryDir(cacheKey);
    await IOUtils.makeDirectory(entryDir, {
      createAncestors: true,
      ignoreExisting: true,
    });

    index[cacheKey] = {
      cacheKey,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      parentItemKey: parent?.key || null,
      title: this.resolveTitle(attachment),
      fileName: attachment.attachmentFilename || "document.pdf",
      fileSize: fingerprint.fileSize,
      fileMtime: fingerprint.fileMtime,
      contentLength: markdown.length,
      parsedAt: Date.now(),
      status: "ready",
    };

    await IOUtils.writeUTF8(this.getMarkdownPath(cacheKey), markdown);
    await this.saveIndex();
  }

  async markFailed(
    attachment: Zotero.Item,
    errorMessage: string,
  ): Promise<void> {
    const fingerprint = await this.getAttachmentFingerprint(attachment);
    const cacheKey = buildMineruCacheKey(attachment.libraryID, attachment.key);
    const index = await this.loadIndex();
    const parent = getParentItem(attachment);

    index[cacheKey] = {
      cacheKey,
      attachmentKey: attachment.key,
      libraryID: attachment.libraryID,
      parentItemKey: parent?.key || null,
      title: this.resolveTitle(attachment),
      fileName: attachment.attachmentFilename || "document.pdf",
      fileSize: fingerprint?.fileSize || 0,
      fileMtime: fingerprint?.fileMtime || 0,
      contentLength: 0,
      parsedAt: Date.now(),
      status: "failed",
      errorMessage,
    };
    await this.saveIndex();
  }

  async listItems(): Promise<MineruCacheListItem[]> {
    const index = await this.loadIndex();
    const items: MineruCacheListItem[] = [];

    for (const record of Object.values(index)) {
      const attachment = getZoteroItemByKey(
        record.libraryID,
        record.attachmentKey,
      );
      if (!attachment) {
        items.push({ ...record, runtimeStatus: "missing" });
        continue;
      }

      try {
        const fingerprint = await this.getAttachmentFingerprint(attachment);
        if (!fingerprint) {
          items.push({ ...record, runtimeStatus: "missing" });
          continue;
        }

        if (record.status === "failed") {
          items.push({ ...record, runtimeStatus: "failed" });
          continue;
        }

        if (
          !isCacheRecordFresh(
            record,
            fingerprint.fileSize,
            fingerprint.fileMtime,
          )
        ) {
          items.push({ ...record, runtimeStatus: "stale" });
          continue;
        }

        const markdownPath = await this.resolveMarkdownPath(record.cacheKey);
        if (!markdownPath) {
          items.push({ ...record, runtimeStatus: "stale" });
          continue;
        }

        items.push({ ...record, runtimeStatus: "ready" });
      } catch {
        items.push({ ...record, runtimeStatus: "missing" });
      }
    }

    return items.sort((a, b) => b.parsedAt - a.parsedAt);
  }

  async deleteRecord(cacheKey: string): Promise<void> {
    const index = await this.loadIndex();
    delete index[cacheKey];
    await this.removeEntryArtifacts(cacheKey);
    await this.saveIndex();
  }

  async deleteAll(): Promise<void> {
    const index = await this.loadIndex();
    for (const cacheKey of Object.keys(index)) {
      await this.removeEntryArtifacts(cacheKey);
    }
    this.index = {};
    await this.saveIndex();
  }

  async repairCache(): Promise<number> {
    const items = await this.listItems();
    let removed = 0;
    for (const item of items) {
      if (item.runtimeStatus === "stale" || item.runtimeStatus === "missing") {
        await this.deleteRecord(item.cacheKey);
        removed += 1;
      }
    }
    return removed;
  }

  async getAttachmentsByCacheKeys(
    cacheKeys: readonly string[],
  ): Promise<Zotero.Item[]> {
    const index = await this.loadIndex();
    const attachments: Zotero.Item[] = [];
    for (const cacheKey of cacheKeys) {
      const record = index[cacheKey];
      if (!record) {
        continue;
      }
      const attachment = getZoteroItemByKey(
        record.libraryID,
        record.attachmentKey,
      );
      if (!attachment?.isPDFAttachment?.()) {
        continue;
      }
      attachments.push(attachment);
    }
    return attachments;
  }

  async listPdfAttachmentsNeedingCache(): Promise<Zotero.Item[]> {
    const search = new Zotero.Search({
      libraryID: Zotero.Libraries.userLibraryID,
    });
    search.addCondition("itemType", "is", "attachment");
    const ids = await search.search();

    const pending: Zotero.Item[] = [];
    const items = await Zotero.Items.getAsync(ids);
    for (const attachment of items) {
      if (!isZoteroItemAlive(attachment) || !attachment.isPDFAttachment?.()) {
        continue;
      }
      try {
        const cached = await this.getCachedMarkdown(attachment);
        if (!cached) {
          pending.push(attachment);
        }
      } catch {
        continue;
      }
    }
    return pending;
  }
}

let cacheService: MinerUCacheService | null = null;

export function getMinerUCacheService(): MinerUCacheService {
  if (!cacheService) {
    cacheService = new MinerUCacheService();
  }
  return cacheService;
}
