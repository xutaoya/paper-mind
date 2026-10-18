import type { WebSearchIntent } from "../../../types/tool";
import {
  isExaWebSearchEnabled,
  searchExa,
  type ExaSearchResult,
} from "./ExaApi";
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResult,
} from "./WebSearchProvider";
import {
  buildSeedEnrichedQuery,
  cleanText,
  matchesDomainFilter,
  postProcessResults,
} from "./WebSearchUtils";

const SCHOLARLY_EXA_INTENTS = new Set<WebSearchIntent>([
  "paper",
  "related",
  "discover",
  "biomedical",
]);

export class ExaProvider implements WebSearchProvider {
  readonly id = "exa";
  readonly displayName = "Exa";
  private readonly timeoutMs = 12000;

  async search(request: WebSearchRequest): Promise<WebSearchResponse> {
    if (!isExaWebSearchEnabled()) {
      throw new Error(
        "Exa web search is disabled. Enable it in PaperMind settings and provide an API key.",
      );
    }

    const body: Record<string, unknown> = {
      query: buildSeedEnrichedQuery(request),
      numResults: Math.min(request.maxResults * 2, 12),
      type: "auto",
      contents: {
        highlights: { maxCharacters: 320 },
        ...(request.includeContent
          ? { text: { maxCharacters: 1800, verbosity: "compact" } }
          : {}),
      },
    };

    if (SCHOLARLY_EXA_INTENTS.has(request.intent)) {
      body.category = "research paper";
    }

    const response = await searchExa(body, this.timeoutMs);
    const rawResults = (response.results || [])
      .map((result) => this.mapResult(result, request))
      .filter((result) =>
        matchesDomainFilter(result.url, request.domainFilter),
      );

    return {
      providerId: this.id,
      provider: this.displayName,
      results: postProcessResults(rawResults, request),
    };
  }

  private mapResult(
    result: ExaSearchResult,
    request: WebSearchRequest,
  ): WebSearchResult {
    const title = cleanText(result.title || "");
    const url = cleanText(result.url || "");
    const snippet = cleanText(
      result.highlights?.join(" ") || result.summary || result.text || "",
    );
    const authors = cleanText(result.author || "")
      ? [cleanText(result.author || "")]
      : undefined;
    const year = this.parseYear(result.publishedDate);

    const mapped: WebSearchResult = {
      title: title || url,
      url,
      snippet,
      authors,
      year,
    };

    if (request.includeContent && result.text) {
      mapped.contentExcerpt = cleanText(result.text);
      mapped.contentType = "webpage_excerpt";
    }

    return mapped;
  }

  private parseYear(publishedDate?: string): number | undefined {
    if (!publishedDate) {
      return undefined;
    }
    const match = publishedDate.match(/\b(19|20)\d{2}\b/);
    if (!match) {
      return undefined;
    }
    return Number.parseInt(match[0], 10);
  }
}
