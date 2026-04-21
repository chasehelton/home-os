import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseToMarkdown, classifyImport } from '../src/recipes/parse.js';

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Best Chocolate Chip Cookies</title>
  <meta property="og:image" content="https://example.com/cookie.jpg" />
  <meta name="description" content="The ultimate cookie recipe." />
  <meta name="author" content="Chef Jane" />
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Recipe",
      "name": "Best Chocolate Chip Cookies",
      "author": { "@type": "Person", "name": "Chef Jane" },
      "description": "The ultimate cookie recipe.",
      "image": ["https://example.com/cookie.jpg"]
    }
  </script>
</head>
<body>
  <header>Site header</header>
  <nav>nav</nav>
  <article>
    <h1>Best Chocolate Chip Cookies</h1>
    <p>These cookies are incredible. Golden edges, gooey centers, rich brown butter notes.</p>
    <h2>Ingredients</h2>
    <ul>
      <li>2 cups flour</li>
      <li>1 cup butter</li>
      <li>1 cup chocolate chips</li>
      <li>2 eggs</li>
    </ul>
    <h2>Instructions</h2>
    <ol>
      <li>Cream the butter and sugar together.</li>
      <li>Beat in the eggs.</li>
      <li>Mix in the flour.</li>
      <li>Fold in the chocolate chips.</li>
      <li>Bake at 375F for 12 minutes.</li>
    </ol>
  </article>
  <footer>Footer</footer>
</body>
</html>`;

describe('parseToMarkdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts title and produces markdown body from article content', async () => {
    const result = await parseToMarkdown(SAMPLE_HTML, 'https://example.com/cookies');
    expect(result.title).toMatch(/Chocolate Chip Cookies/i);
    expect(result.markdown.length).toBeGreaterThan(50);
    // Ingredients / Instructions should survive the markdown conversion
    expect(result.markdown.toLowerCase()).toContain('ingredients');
    expect(result.markdown.toLowerCase()).toContain('instructions');
    expect(result.markdown).toContain('flour');
  });

  it('returns null-ish fields when defuddle has nothing to work with', async () => {
    const result = await parseToMarkdown('<html><body></body></html>', 'https://example.com/empty');
    expect(result.markdown.length).toBeLessThan(120);
    expect(classifyImport(result)).toBe('partial');
  });

  it('classifies a well-formed recipe as "imported"', async () => {
    const result = await parseToMarkdown(SAMPLE_HTML, 'https://example.com/cookies');
    expect(classifyImport(result)).toBe('imported');
  });
});
