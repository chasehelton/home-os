import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';

export interface DefuddleResult {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  domain: string | null;
  imageUrl: string | null;
  markdown: string;
  wordCount: number;
}

/**
 * Run html through defuddle to strip chrome and convert the main content to
 * markdown. Uses linkedom as the DOM implementation (faster + lighter than JSDOM
 * and sufficient for what defuddle needs).
 */
export async function parseToMarkdown(html: string, pageUrl: string): Promise<DefuddleResult> {
  const { document } = parseHTML(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (await Defuddle(document as any, pageUrl, { markdown: true })) as {
    title?: string;
    description?: string;
    author?: string;
    site?: string;
    domain?: string;
    image?: string;
    content?: string;
    wordCount?: number;
  };
  return {
    title: nullIfEmpty(result.title),
    description: nullIfEmpty(result.description),
    author: nullIfEmpty(result.author),
    siteName: nullIfEmpty(result.site),
    domain: nullIfEmpty(result.domain),
    imageUrl: nullIfEmpty(result.image),
    markdown: typeof result.content === 'string' ? result.content : '',
    wordCount: typeof result.wordCount === 'number' ? result.wordCount : 0,
  };
}

function nullIfEmpty(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/**
 * A recipe is "imported" if defuddle returned a title and a non-trivial body.
 * Anything else we flag as "partial" so the UI can prompt the user to clean
 * it up.
 */
export function classifyImport(r: DefuddleResult): 'imported' | 'partial' {
  return r.title && r.markdown.trim().length >= 120 ? 'imported' : 'partial';
}
