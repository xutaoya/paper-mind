import { assert } from "chai";
import { config } from "../package.json";
import "../src/utils/setImmediatePolyfill.ts";
import JSZip from "jszip";
import {
  extractMarkdownFromZipBytes,
  extractMineruZipToDirectory,
  normalizeZipEntryPath,
} from "../src/modules/chat/MinerUZipArchive.ts";

describe("MinerU archive extraction in Zotero", function () {
  let originalZtoolkit: PropertyDescriptor | undefined;

  before(function () {
    originalZtoolkit = Object.getOwnPropertyDescriptor(globalThis, "ztoolkit");
    Object.defineProperty(globalThis, "ztoolkit", {
      configurable: true,
      get: () => (Zotero as any)[config.addonInstance].data.ztoolkit,
    });
  });

  after(function () {
    if (originalZtoolkit)
      Object.defineProperty(globalThis, "ztoolkit", originalZtoolkit);
    else delete (globalThis as any).ztoolkit;
  });

  it("normalizes unsafe zip entry paths", function () {
    assert.equal(
      normalizeZipEntryPath("demo:folder/full.md"),
      "demo_folder/full.md",
    );
    assert.equal(normalizeZipEntryPath("C:/demo/full.md"), "demo/full.md");
    assert.isNull(normalizeZipEntryPath("../full.md"));
  });

  it("extracts full.md from MinerU zip archives", async function () {
    const archive = new JSZip();
    archive.file("demo/full.md", "# Title\n\nBody");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const markdown = await extractMarkdownFromZipBytes(bytes);
    assert.equal(markdown, "# Title\n\nBody");
  });

  it("extracts images and markdown into a cache directory", async function () {
    if (typeof Zotero === "undefined") {
      this.skip();
    }
    const archive = new JSZip();
    archive.file("full.md", "See ![fig](images/demo.jpg)");
    archive.file("images/demo.jpg", "fake-image-bytes");
    archive.file("layout.json", "{}");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const targetDir = PathUtils.join(
      Zotero.DataDirectory.dir,
      "paper-chat",
      "mineru-cache-test",
      String(Date.now()),
    );
    try {
      const markdown = await extractMineruZipToDirectory(bytes, targetDir);
      assert.equal(markdown, "See ![fig](images/demo.jpg)");
      assert.isTrue(await IOUtils.exists(PathUtils.join(targetDir, "full.md")));
      assert.isTrue(
        await IOUtils.exists(PathUtils.join(targetDir, "images", "demo.jpg")),
      );
      assert.isTrue(
        await IOUtils.exists(PathUtils.join(targetDir, "layout.json")),
      );
    } catch (error) {
      assert.fail(String(error));
    } finally {
      await IOUtils.remove(targetDir, { recursive: true, ignoreAbsent: true });
    }
  });

  it("returns null when zip has no markdown", async function () {
    const archive = new JSZip();
    archive.file("demo/layout.json", "{}");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const markdown = await extractMarkdownFromZipBytes(bytes);
    assert.isNull(markdown);
  });

  it("sanitizes unsafe zip entry paths and still writes canonical full.md", async function () {
    if (typeof Zotero === "undefined") {
      this.skip();
    }
    const archive = new JSZip();
    archive.file("bad:folder/full.md", "# Unsafe path\n\nBody");
    archive.file("bad:folder/images/demo.jpg", "fake-image-bytes");
    const bytes = await archive.generateAsync({ type: "uint8array" });
    const targetDir = PathUtils.join(
      Zotero.DataDirectory.dir,
      "paper-chat",
      "mineru-cache-test",
      String(Date.now()),
    );
    try {
      const markdown = await extractMineruZipToDirectory(bytes, targetDir);
      assert.equal(markdown, "# Unsafe path\n\nBody");
      assert.isTrue(await IOUtils.exists(PathUtils.join(targetDir, "full.md")));
    } catch (error) {
      assert.fail(String(error));
    } finally {
      await IOUtils.remove(targetDir, { recursive: true, ignoreAbsent: true });
    }
  });
});
