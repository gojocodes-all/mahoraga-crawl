import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import { extractBusinessRecords } from '../src/index.js';

function pageWithBusinesses(businesses) {
  return load(`
    <html>
      <head>
        <title>Example directory</title>
        <script type="application/ld+json">
          ${JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': businesses,
          })}
        </script>
      </head>
      <body>
        <a href="tel:+234 800 000 0000">Directory support</a>
        <a href="mailto:directory@example.com">Email the directory</a>
      </body>
    </html>
  `);
}

test('directory contacts do not collapse distinct structured businesses', () => {
  const $ = pageWithBusinesses([
    {
      '@type': 'LocalBusiness',
      name: 'Alpha Bakery',
      url: 'https://alpha.example',
    },
    {
      '@type': 'LocalBusiness',
      name: 'Beta Pharmacy',
      url: 'https://beta.example',
    },
  ]);

  const records = extractBusinessRecords($, 'https://directory.example');

  assert.equal(records.length, 2);
  assert.deepEqual(
    records.map(record => record.title),
    ['Alpha Bakery', 'Beta Pharmacy'],
  );
  assert.ok(records.every(record => record.phone === ''));
  assert.ok(records.every(record => record.email === ''));
});

test('page contacts remain a fallback for one structured business', () => {
  const $ = pageWithBusinesses([
    {
      '@type': 'LocalBusiness',
      name: 'Alpha Bakery',
      url: 'https://alpha.example',
    },
  ]);

  const [record] = extractBusinessRecords($, 'https://alpha.example');

  assert.equal(record.phone, '+234 800 000 0000');
  assert.equal(record.email, 'directory@example.com');
});
