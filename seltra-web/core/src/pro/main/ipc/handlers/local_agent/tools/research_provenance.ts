import type { ExperimentResearchSource } from "@/ipc/types/experiment_artifact";
import log from "electron-log";
import type { AgentContext } from "./types";

const logger = log.scope("experiment_research");

const MAX_SOURCES_PER_CAPTURE = 16;
const MAX_SOURCE_STATEMENTS = 8;
const MAX_STATEMENT_LENGTH = 500;

function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // Search results may contain tracking or signed query parameters. A clean
    // page URL is enough to preserve provenance without retaining credentials.
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STATEMENT_LENGTH);
}

function sourceStatements(markdown: string): string[] {
  const statements = markdown
    .split(/\r?\n/)
    .map((line) => cleanText(line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")))
    .filter((line) => line.length >= 32)
    .slice(0, MAX_SOURCE_STATEMENTS);
  return [...new Set(statements)];
}

function makeSource(
  urlValue: string,
  titleValue: string,
  retrievedAt: string,
  markdown = "",
): ExperimentResearchSource | undefined {
  const url = safeSourceUrl(urlValue);
  if (!url) return undefined;
  const title = cleanText(titleValue) || new URL(url).hostname;
  return {
    url,
    title,
    retrievedAt,
    sourceStatements: sourceStatements(markdown),
    // Retrieved text is evidence from a source, not an independently verified
    // fact. Keep both verification and design interpretation for later review.
    verifiedFacts: [],
    designInferences: [],
    confidence: "low",
  };
}

function dedupeSources(
  sources: (ExperimentResearchSource | undefined)[],
): ExperimentResearchSource[] {
  const unique = new Map<string, ExperimentResearchSource>();
  for (const source of sources) {
    if (source && !unique.has(source.url)) unique.set(source.url, source);
  }
  return [...unique.values()].slice(0, MAX_SOURCES_PER_CAPTURE);
}

export function researchSourcesFromSearch(
  result: string,
  retrievedAt = new Date().toISOString(),
): ExperimentResearchSource[] {
  const sources: (ExperimentResearchSource | undefined)[] = [];
  const links = /\[([^\]]{1,300})\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of result.matchAll(links)) {
    sources.push(makeSource(match[2], match[1], retrievedAt));
    if (sources.length >= MAX_SOURCES_PER_CAPTURE * 2) break;
  }
  return dedupeSources(sources);
}

export function researchSourcesFromPages(
  pages: { url: string; markdown: string }[],
  retrievedAt = new Date().toISOString(),
): ExperimentResearchSource[] {
  return dedupeSources(
    pages.slice(0, MAX_SOURCES_PER_CAPTURE).map((page) => {
      const heading = page.markdown.match(/^\s*#\s+(.+)$/m)?.[1];
      let fallbackTitle = page.url;
      try {
        fallbackTitle = new URL(page.url).hostname;
      } catch {
        // makeSource rejects this URL; the fallback title is not persisted.
      }
      return makeSource(
        page.url,
        heading ?? fallbackTitle,
        retrievedAt,
        page.markdown,
      );
    }),
  );
}

export async function recordResearchSources(
  ctx: Pick<AgentContext, "recordResearchSources">,
  sources: ExperimentResearchSource[],
): Promise<void> {
  if (!ctx.recordResearchSources || sources.length === 0) return;
  try {
    await ctx.recordResearchSources(sources);
  } catch {
    // Provenance is supplemental and must not discard a successful search.
    logger.warn("Could not persist research source provenance.");
  }
}
