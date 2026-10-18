import { getPref } from "../../utils/prefs";
import { getMinerUCacheService } from "./MinerUCacheService";
import {
  extractMarkdownFromZipBytes,
  extractMineruZipToDirectory,
} from "./MinerUZipArchive";

export { extractMarkdownFromZipBytes, extractMineruZipToDirectory };

const MINERU_API_BASE = "https://mineru.net/api/v4";
const MINERU_TEST_PDF_URL =
  "https://cdn-mineru.openxlab.org.cn/demo/example.pdf";
const MINERU_MODEL_VERSION = "vlm";
const POLL_INTERVAL_MS = 3000;
const PARSE_TIMEOUT_MS = 600_000;

interface MineruApiResponse<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
}

interface MineruExtractResult {
  state?: string;
  full_zip_url?: string;
  err_msg?: string;
  file_name?: string;
}

export function isMineruFallbackEnabled(): boolean {
  return getPref("useMineruOnExtractFailure") === true;
}

export function getMineruApiToken(): string {
  return String(getPref("mineruApiToken") || "").trim();
}

function getFetch(): typeof fetch {
  const win = Zotero.getMainWindow();
  if (!win?.fetch) {
    throw new Error("fetch is unavailable in main window");
  }
  return win.fetch.bind(win);
}

function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function assertMineruSuccess<T>(payload: MineruApiResponse<T>): T {
  if (!payload || payload.code !== 0 || payload.data == null) {
    throw new Error(payload?.msg || "MinerU API request failed");
  }
  return payload.data;
}

function normalizeExtractResults(
  data: Record<string, unknown>,
): MineruExtractResult[] {
  const raw = data.extract_result;
  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is MineruExtractResult => !!item && typeof item === "object",
    );
  }
  if (raw && typeof raw === "object") {
    return [raw as MineruExtractResult];
  }
  return [];
}

async function downloadZipBytes(zipUrl: string): Promise<Uint8Array> {
  const response = await getFetch()(zipUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download MinerU result zip: HTTP ${response.status}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function pollBatchResult(
  token: string,
  batchId: string,
  fileName: string,
  timeoutMs: number,
): Promise<MineruExtractResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await getFetch()(
      `${MINERU_API_BASE}/extract-results/batch/${encodeURIComponent(batchId)}`,
      {
        method: "GET",
        headers: authHeaders(token),
      },
    );
    const payload = (await response.json()) as MineruApiResponse<
      Record<string, unknown>
    >;
    const data = assertMineruSuccess(payload);
    const results = normalizeExtractResults(data);
    const match =
      results.find((item) => item.file_name === fileName) || results[0];
    if (!match) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    const state = match.state || "";
    if (state === "done") {
      return match;
    }
    if (state === "failed") {
      throw new Error(match.err_msg || "MinerU batch task failed");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("MinerU batch task timed out");
}

async function uploadLocalPdf(
  token: string,
  filePath: string,
  fileName: string,
): Promise<string> {
  const response = await getFetch()(`${MINERU_API_BASE}/file-urls/batch`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      files: [{ name: fileName }],
      model_version: MINERU_MODEL_VERSION,
    }),
  });
  const payload = (await response.json()) as MineruApiResponse<{
    batch_id?: string;
    file_urls?: string[];
  }>;
  const data = assertMineruSuccess(payload);
  const uploadUrl = data.file_urls?.[0];
  const batchId = data.batch_id;
  if (!uploadUrl || !batchId) {
    throw new Error("MinerU did not return upload URL");
  }

  const fileBytes = await IOUtils.read(filePath);
  const status = await putWithoutContentType(uploadUrl, fileBytes);
  if (status < 200 || status >= 300) {
    throw new Error(`MinerU file upload failed: HTTP ${status}`);
  }
  return batchId;
}

/** OSS presigned URLs 403 if fetch/Blob adds Content-Type. */
function putWithoutContentType(
  url: string,
  bytes: Uint8Array,
): Promise<number> {
  const win = Zotero.getMainWindow();
  return new Promise((resolve, reject) => {
    const xhr = new win.XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error("MinerU file upload network error"));
    xhr.send(bytes);
  });
}

export async function testMineruApiToken(
  tokenInput?: string,
): Promise<{ success: boolean; message: string }> {
  const token = (tokenInput ?? getMineruApiToken()).trim();
  if (!token) {
    return { success: false, message: "请先填写 MinerU Token" };
  }

  try {
    const response = await getFetch()(`${MINERU_API_BASE}/extract/task`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        url: MINERU_TEST_PDF_URL,
        model_version: MINERU_MODEL_VERSION,
      }),
    });
    const payload = (await response.json()) as MineruApiResponse<{
      task_id?: string;
    }>;
    const data = assertMineruSuccess(payload);
    const taskId = data.task_id;
    if (!taskId) {
      return { success: false, message: "MinerU 未返回 task_id" };
    }
    return {
      success: true,
      message: `Token 有效，测试任务已创建（${taskId}）`,
    };
  } catch (error) {
    return { success: false, message: getErrorMessage(error) };
  }
}

export async function parsePdfAttachmentText(
  attachment: Zotero.Item,
): Promise<string | null> {
  if (!isMineruFallbackEnabled()) {
    return null;
  }

  const token = getMineruApiToken();
  if (!token) {
    ztoolkit.log("[MinerUParser] MinerU token is not configured");
    return null;
  }

  return parsePdfAttachmentWithMinerU(attachment);
}

export async function parsePdfAttachmentWithMinerU(
  attachment: Zotero.Item,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const token = getMineruApiToken();
  if (!token) {
    return null;
  }

  try {
    if (!options.forceRefresh) {
      const cached =
        await getMinerUCacheService().getCachedMarkdown(attachment);
      if (cached) {
        ztoolkit.log(
          "[MinerUParser] Using cached MinerU markdown, length:",
          cached.length,
        );
        return cached;
      }
    }

    const path = await attachment.getFilePathAsync();
    if (!path) {
      return null;
    }

    const fileName = attachment.attachmentFilename || "document.pdf";
    const zipBytes = await parsePdfFileWithToken(token, path, fileName);
    if (zipBytes) {
      const markdown = await getMinerUCacheService().saveCachedParseResult(
        attachment,
        zipBytes,
      );
      return markdown;
    }
    return null;
  } catch (error) {
    const message = getErrorMessage(error);
    ztoolkit.log("[MinerUParser] Failed to parse attachment:", error);
    try {
      await getMinerUCacheService().markFailed(attachment, message);
    } catch (cacheError) {
      ztoolkit.log(
        "[MinerUParser] Failed to record cache failure:",
        cacheError,
      );
    }
    return null;
  }
}

export async function parsePdfFile(
  filePath: string,
  fileName: string,
): Promise<string | null> {
  if (!isMineruFallbackEnabled()) {
    return null;
  }

  const token = getMineruApiToken();
  if (!token) {
    return null;
  }

  try {
    const zipBytes = await parsePdfFileWithToken(token, filePath, fileName);
    if (!zipBytes) {
      return null;
    }
    return extractMarkdownFromZipBytes(zipBytes);
  } catch (error) {
    ztoolkit.log("[MinerUParser] Failed to call MinerU API:", error);
    return null;
  }
}

async function parsePdfFileWithToken(
  token: string,
  filePath: string,
  fileName: string,
): Promise<Uint8Array | null> {
  const batchId = await uploadLocalPdf(token, filePath, fileName);
  const result = await pollBatchResult(
    token,
    batchId,
    fileName,
    PARSE_TIMEOUT_MS,
  );
  if (!result.full_zip_url) {
    throw new Error("MinerU completed without result zip URL");
  }

  const zipBytes = await downloadZipBytes(result.full_zip_url);
  ztoolkit.log(
    "[MinerUParser] Downloaded MinerU result zip, bytes:",
    zipBytes.length,
  );
  return zipBytes;
}
