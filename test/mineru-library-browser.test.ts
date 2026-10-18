import { assert } from "chai";
import {
  buildLibraryRows,
  formatCreatorLabel,
  formatItemYear,
  tagColor,
} from "../src/modules/preferences/MinerULibraryBrowser.ts";
import type { MineruCacheListItem } from "../src/modules/chat/MinerUCacheService.ts";

describe("mineru library browser", function () {
  it("formats creator labels like Zotero", function () {
    const item = {
      getCreators: () => [
        { lastName: "Ma", firstName: "J" },
        { lastName: "Li", firstName: "Q" },
      ],
    } as Zotero.Item;
    assert.equal(formatCreatorLabel(item), "Ma 等");
  });

  it("filters rows by tag and search", function () {
    const cacheItems: MineruCacheListItem[] = [
      {
        cacheKey: "1_ABC",
        attachmentKey: "ABC",
        libraryID: 1,
        parentItemKey: "PARENT",
        title: "SwinFusion",
        fileName: "swin.pdf",
        fileSize: 1,
        fileMtime: 1,
        contentLength: 10,
        parsedAt: Date.now(),
        status: "ready",
        runtimeStatus: "ready",
      },
    ];
    const attachment = {
      libraryID: 1,
      key: "ABC",
      parentItemID: 9,
      attachmentFilename: "swin.pdf",
      dateAdded: "2026-08-03T00:00:00.000Z",
      isAttachment: () => true,
      isPDFAttachment: () => true,
      getDisplayTitle: () => "swin.pdf",
    } as Zotero.Item;
    const parent = {
      getField: (field: string) =>
        field === "title" ? "SwinFusion" : field === "year" ? "2022" : "",
      getTags: () => [{ tag: "Image Fusion" }],
      getCreators: () => [{ lastName: "Ma", firstName: "J" }],
      dateAdded: "2026-08-03T00:00:00.000Z",
    } as Zotero.Item;
    const originalGet = (globalThis as { Zotero?: typeof Zotero }).Zotero?.Items
      .get;
    (globalThis as { Zotero: typeof Zotero }).Zotero = {
      Items: {
        get: ((id: number) =>
          id === 9 ? parent : originalGet?.(id)) as typeof Zotero.Items.get,
      },
    } as typeof Zotero;

    try {
      const tagged = buildLibraryRows([attachment], cacheItems, {
        tag: "Image Fusion",
      });
      assert.lengthOf(tagged, 1);
      assert.equal(tagged[0].year, "2022");

      const searched = buildLibraryRows([attachment], cacheItems, {
        search: "swinfusion",
      });
      assert.lengthOf(searched, 1);

      const missingTag = buildLibraryRows([attachment], cacheItems, {
        tag: "Other",
      });
      assert.lengthOf(missingTag, 0);
    } finally {
      if (originalGet) {
        (globalThis as { Zotero: typeof Zotero }).Zotero.Items.get =
          originalGet;
      }
    }
  });

  it("assigns stable tag colors", function () {
    assert.equal(tagColor("Image Fusion"), tagColor("Image Fusion"));
    assert.notEqual(tagColor("A"), tagColor("B"));
  });
});
