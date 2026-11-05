import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../worker.ts', import.meta.url), 'utf8');
const workerApiSource = await readFile(new URL('../worker-api.ts', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.ts', import.meta.url), 'utf8');
const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const robots = await readFile(new URL('../public/robots.txt', import.meta.url), 'utf8');
const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
) as { scripts: { deploy: string } };

test('Wrangler deploy config targets the production Worker and preserves dashboard variables', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
    name?: string;
    keep_vars?: boolean;
    triggers?: unknown;
    r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  };
  assert.equal(config.name, 'uptrends-english-academy');
  assert.equal(config.keep_vars, true);
  assert.equal(config.triggers, undefined);
  assert.deepEqual(config.r2_buckets, [
    { binding: 'APPLICATION_MEDIA', bucket_name: 'uptrends-academy-media' },
    { binding: 'PUBLIC_MEDIA', bucket_name: 'uptrends-academy-public' },
  ]);
});

test('deploy script uses the Wrangler config actually emitted by Vite', () => {
  assert.match(packageJson.scripts.deploy, /dist\/uptrends_english_academy\/wrangler\.json/);
  assert.match(viteConfig, /dist\/uptrends_english_academy\/\.dev\.vars/);
  assert.doesNotMatch(workerSource, /scheduled\(/);
  assert.doesNotMatch(workerApiSource, /runPaymentDocumentRecovery|reconcile_payment_document_versions/);
  assert.doesNotMatch(workerApiSource, /\/api\/admin\/payments|\/payments|application_payments/);
  assert.doesNotMatch(serverSource, /\/api\/admin\/payments|\/payments/);
  assert.match(serverSource, /app\.all\('\/api\/\*'/);
});

test('public SEO files list only the canonical public homepage and identify the sitemap', () => {
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, url]) => url), [
    'https://uptrendsenglishacademy.in/',
  ]);
  assert.match(robots, /^User-agent: \*\r?\nAllow: \/\r?\n\r?\nSitemap: https:\/\/uptrendsenglishacademy\.in\/sitemap\.xml\s*$/);
});

test('Worker serves successful static asset responses instead of the SPA fallback', () => {
  assert.match(workerSource, /const assetResponse = await env\.ASSETS\.fetch\(request\);/);
  assert.match(workerSource, /if \(assetResponse\.status !== 404\) \{\s*return assetResponse;\s*\}/);
});
