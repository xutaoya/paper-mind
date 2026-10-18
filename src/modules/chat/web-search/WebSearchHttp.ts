import { getErrorMessage } from "../../../utils/common";
import { loadPageWithHiddenBrowser } from "./HiddenBrowserSearch";

export interface HttpResponse {
  status: number;
  statusText: string;
  contentType: string;
  contentLength?: number;
  body: string;
}

interface RequestOptions {
  timeoutMs: number;
  method?: "GET" | "HEAD" | "POST";
  accept?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function requestHttp(
  url: string,
  {
    timeoutMs,
    method = "GET",
    accept = "application/json,text/plain,*/*",
    body,
    headers = {},
  }: RequestOptions,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timeoutTriggered = false;

    xhr.open(method, url, true);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Accept", accept);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.onload = () => {
      const contentLengthHeader = xhr.getResponseHeader("Content-Length");
      resolve({
        status: xhr.status,
        statusText: xhr.statusText,
        contentType: xhr.getResponseHeader("Content-Type") || "",
        contentLength: contentLengthHeader
          ? Number.parseInt(contentLengthHeader, 10)
          : undefined,
        body: xhr.responseText || "",
      });
    };

    xhr.onerror = () => {
      reject(new Error(`Request failed for ${url}`));
    };

    xhr.ontimeout = () => {
      timeoutTriggered = true;
      xhr.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms: ${url}`));
    };

    xhr.onabort = () => {
      if (timeoutTriggered) {
        return;
      }
      reject(new Error(`Request aborted: ${url}`));
    };

    xhr.send(body);
  });
}

export async function fetchSearchHtml(
  url: string,
  options: {
    timeoutMs: number;
    accept?: string;
    validate?: (html: string) => void;
    hiddenBrowserTimeoutMs?: number;
  },
): Promise<string> {
  try {
    const response = await requestHttp(url, {
      timeoutMs: options.timeoutMs,
      method: "GET",
      accept: options.accept ?? "text/html,application/xhtml+xml",
    });
    if (response.status >= 200 && response.status < 300 && response.body) {
      try {
        options.validate?.(response.body);
        return response.body;
      } catch (error) {
        const message = getErrorMessage(error);
        if (/challenge|anomaly|blocked|unusual traffic/i.test(message)) {
          throw error;
        }
        ztoolkit.log(`[WebSearch] XHR page rejected for ${url}: ${message}`);
      }
    }
  } catch (error) {
    const message = getErrorMessage(error);
    if (/challenge|anomaly|blocked|unusual traffic/i.test(message)) {
      throw error;
    }
    ztoolkit.log(`[WebSearch] XHR fetch failed for ${url}: ${message}`);
  }

  const pageData = await loadPageWithHiddenBrowser(url, {
    timeoutMs:
      options.hiddenBrowserTimeoutMs ?? Math.max(options.timeoutMs, 15000),
    settleDelayMs: 1200,
  });
  if (!pageData.html) {
    throw new Error(`Web search page returned empty HTML for ${url}`);
  }
  options.validate?.(pageData.html);
  return pageData.html;
}

function parseJsonResponse<T>(url: string, response: HttpResponse): T {
  if (response.status < 200 || response.status >= 300) {
    let detail = response.body.trim();
    if (detail.length > 220) {
      detail = `${detail.slice(0, 220)}...`;
    }
    throw new Error(
      detail
        ? `Request failed: ${response.status} ${response.statusText} (${url}) — ${detail}`
        : `Request failed: ${response.status} ${response.statusText} (${url})`,
    );
  }

  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}

export async function requestJson<T>(
  url: string,
  timeoutMs: number,
): Promise<T> {
  const response = await requestHttp(url, {
    timeoutMs,
    accept: "application/json,text/plain,*/*",
  });
  return parseJsonResponse<T>(url, response);
}

export async function requestJsonPost<T>(
  url: string,
  body: unknown,
  {
    timeoutMs,
    headers = {},
  }: {
    timeoutMs: number;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const response = await requestHttp(url, {
    timeoutMs,
    method: "POST",
    accept: "application/json,text/plain,*/*",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
  return parseJsonResponse<T>(url, response);
}
