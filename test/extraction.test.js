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

test('structured address regions and countries use their names', () => {
  const $ = pageWithBusinesses([
    {
      '@type': 'LocalBusiness',
      name: 'Alpha Bakery',
      address: {
        '@type': 'PostalAddress',
        streetAddress: '12 Example Road',
        addressLocality: 'Ikeja',
        addressRegion: {
          '@type': 'AdministrativeArea',
          name: 'Lagos',
        },
        postalCode: '100001',
        addressCountry: {
          '@type': 'Country',
          name: 'NG',
        },
      },
    },
  ]);

  const [record] = extractBusinessRecords($, 'https://alpha.example');

  assert.equal(record.address, '12 Example Road, Ikeja, Lagos, 100001, NG');
  assert.equal(record.city, 'Ikeja');
  assert.equal(record.state, 'Lagos');
  assert.equal(record.countryCode, 'NG');
  assert.equal(record.address.includes('[object Object]'), false);
});

test('a single sameAs website remains the structured business website', () => {
  const $ = pageWithBusinesses([
    {
      '@type': 'LocalBusiness',
      name: 'Alpha Bakery',
      sameAs: 'https://alpha.example/about',
    },
  ]);

  const [record] = extractBusinessRecords($, 'https://directory.example');

  assert.equal(record.website, 'https://alpha.example/about');
});

test('a single social sameAs value remains a social link', () => {
  const $ = pageWithBusinesses([
    {
      '@type': 'LocalBusiness',
      name: 'Alpha Bakery',
      sameAs: 'https://www.instagram.com/alpha-bakery',
    },
  ]);

  const [record] = extractBusinessRecords($, 'https://directory.example');

  assert.deepEqual(record.socialLinks, [
    'https://www.instagram.com/alpha-bakery',
  ]);
  assert.equal(record.website, 'https://directory.example');
});

