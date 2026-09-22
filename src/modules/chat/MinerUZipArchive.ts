import { ensureSetImmediate } from "../../utils/setImmediatePolyfill";
import JSZip from "jszip";

ensureSetImmediate();

const MAX_PATH_COMPONENT_LENGTH = 200;

function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sanitizeZipPathComponent(part: string): string | null {
  const trimmed = part.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return null;
  }

  const cleaned = trimmed.replace(/[:*?"<>|]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return null;
  }

  if (cleaned.length <= MAX_PATH_COMPONENT_LENGTH) {
    return cleaned;
  }

  const extension = cleaned.includes(".")
    ? cleaned.slice(cleaned.lastIndexOf("."))
    : "";
  const stem = cleaned.slice(
    0,
    Math.max(1, MAX_PATH_COMPONENT_LENGTH - extension.length - 9),
  );
  return `${stem}-${shortHash(cleaned)}${extension}`;
}

export function normalizeZipEntryPath(name: string): string | null {
  let normalized = name.replace(/\\/g, "/").trim();
  normalized = normalized.replace(/^[a-zA-Z]:\//, "");
  normalized = normalized.replace(/^\/+/, "");

  if (!normalized || normalized.endsWith("/")) {
    return null;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the raw path when it is not URI-encoded.
  }

  const parts = normalized.split("/").filter(Boolean);
  const sanitizedParts: string[] = [];
  for (const part of parts) {
    const sanitized = sanitizeZipPathComponent(part);
    if (!sanitized) {
      return null;
    }
    sanitizedParts.push(sanitized);
  }

  return sanitizedParts.join("/");
}

function safeJoinPath(baseDir: string, relativePath: string): string | null {
  try {
    return PathUtils.join(baseDir, relativePath);
  } catch (error) {
    ztoolkit.log(
      `[MinerUZip] Skipping invalid zip entry path "${relativePath}":`,
      error,
    );
    return null;
  }
}

async function readMarkdownFromArchive(archive: JSZip): Promise<string | null> {
  const entries = Object.keys(archive.files).filter(
    (name) => !archive.files[name]?.dir && name.toLowerCase().endsWith(".md"),
  );
  if (entries.length === 0) {
    return null;
  }

  const preferred =
    entries.find((name) => /(^|\/)full\.md$/i.test(name)) || entries[0];
  const file = archive.file(preferred);
  if (!file) {
    return null;
  }
  const content = await file.async("string");
  return content.trim() || null;
}

export async function extractMarkdownFromZipBytes(
  bytes: Uint8Array,
): Promise<string | null> {
  const archive = await JSZip.loadAsync(bytes);
  return readMarkdownFromArchive(archive);
}

/** Extract every file in a MinerU zip into targetDir, preserving paths like full.md and images/*. */
export async function extractMineruZipToDirectory(
  bytes: Uint8Array,
  targetDir: string,
): Promise<string | null> {
  const archive = await JSZip.loadAsync(bytes);
  let wroteCanonicalMarkdown = false;

  for (const [rawPath, entry] of Object.entries(archive.files)) {
    if (entry.dir) {
      continue;
    }
    const relativePath = normalizeZipEntryPath(rawPath);
    if (!relativePath) {
      ztoolkit.log(`[MinerUZip] Skipping unsafe zip entry path: ${rawPath}`);
      continue;
    }
    const outputPath = safeJoinPath(targetDir, relativePath);
    if (!outputPath) {
      continue;
    }
    const parentPath = PathUtils.parent(outputPath);
    if (parentPath) {
      await IOUtils.makeDirectory(parentPath, {
        createAncestors: true,
        ignoreExisting: true,
      });
    }
    const content = await entry.async("uint8array");
    await IOUtils.write(outputPath, content);
    if (/(^|\/)full\.md$/i.test(relativePath)) {
      wroteCanonicalMarkdown = true;
    }
  }

  const markdown = await readMarkdownFromArchive(archive);
  if (!markdown) {
    return null;
  }

  const canonicalMarkdownPath = safeJoinPath(targetDir, "full.md");
  if (
    canonicalMarkdownPath &&
    (!wroteCanonicalMarkdown || !(await IOUtils.exists(canonicalMarkdownPath)))
  ) {
    await IOUtils.writeUTF8(canonicalMarkdownPath, markdown);
  }

  return markdown;
}
