import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  extractWikilinks,
  extractTags,
  wordCount,
  renderMarkdown,
} from './vaultMarkdown.js';

test('escapeHtml escapes the five dangerous chars', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('extractWikilinks pulls every [[target]]', () => {
  const body = 'See [[Foo]] and [[Bar Baz|aliased]] and [[Foo]] again.';
  assert.deepEqual(extractWikilinks(body).sort(), ['Bar Baz', 'Foo']);
});

test('extractWikilinks: alias does not change the target', () => {
  const body = '[[Real Target|Display]]';
  assert.deepEqual(extractWikilinks(body), ['Real Target']);
});

test('extractWikilinks: empty body returns []', () => {
  assert.deepEqual(extractWikilinks(''), []);
  assert.deepEqual(extractWikilinks(null), []);
});

test('extractTags strips # and lowercases', () => {
  const body = 'A #Foo and #bar-baz tag, and a #foo dup.';
  assert.deepEqual(extractTags(body).sort(), ['bar-baz', 'foo']);
});

test('extractTags ignores malformed forms (#, # word)', () => {
  assert.deepEqual(extractTags('not a tag # space'), []);
});

test('wordCount strips code, headings, wikilinks', () => {
  const body = '# Title\n\nHello world ```skip me```\n\n[[Foo]] is one word.';
  const n = wordCount(body);
  assert.ok(n >= 5 && n <= 9, `got ${n}`);
});

test('renderMarkdown: paragraph + bold + italic + inline code', () => {
  const out = renderMarkdown('Hello **bold** and *italic* and `code`.');
  assert.match(out, /<p>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>italic<\/em>/);
  assert.match(out, /<code>code<\/code>/);
});

test('renderMarkdown: ATX headings 1-6', () => {
  for (let i = 1; i <= 6; i += 1) {
    const out = renderMarkdown('#'.repeat(i) + ' Title');
    assert.match(out, new RegExp(`<h${i}>Title</h${i}>`));
  }
});

test('renderMarkdown: unordered list', () => {
  const out = renderMarkdown('- one\n- two\n- three');
  assert.match(out, /<ul>/);
  assert.match(out, /<li>one<\/li>/);
  assert.equal((out.match(/<li>/g) || []).length, 3);
});

test('renderMarkdown: ordered list', () => {
  const out = renderMarkdown('1. one\n2. two');
  assert.match(out, /<ol>/);
  assert.equal((out.match(/<li>/g) || []).length, 2);
});

test('renderMarkdown: code fence preserves whitespace and escapes html', () => {
  const out = renderMarkdown('```\n<script>x</script>\n```');
  assert.match(out, /<pre><code>/);
  assert.match(out, /&lt;script&gt;/);
});

test('renderMarkdown: blockquote', () => {
  const out = renderMarkdown('> a quote\n> across two lines');
  assert.match(out, /<blockquote>/);
  assert.match(out, /<\/blockquote>/);
});

test('renderMarkdown: wikilinks render as anchors with classes', () => {
  const out = renderMarkdown('See [[Foo]] for more.');
  assert.match(out, /class="vault-wikilink vault-wikilink-(found|missing)"/);
  assert.match(out, /data-wikilink="Foo"/);
  assert.match(out, /href="#vault\/Foo"/);
});

test('renderMarkdown: aliased wikilink shows alias text', () => {
  const out = renderMarkdown('[[Real|Pretty]]');
  assert.match(out, />Pretty</);
  assert.match(out, /data-wikilink="Real"/);
});

test('renderMarkdown: resolveWikilink toggles found/missing class', () => {
  const out = renderMarkdown('[[Yes]] and [[No]]', {
    resolveWikilink: (t) => t === 'Yes',
  });
  assert.match(out, /class="vault-wikilink vault-wikilink-found"[^>]*>Yes/);
  assert.match(out, /class="vault-wikilink vault-wikilink-missing"[^>]*>No/);
});

test('renderMarkdown: external link safe-listed (https)', () => {
  const out = renderMarkdown('[ok](https://example.com)');
  assert.match(out, /href="https:\/\/example.com"/);
  assert.match(out, /target="_blank"/);
});

test('renderMarkdown: external link with javascript: is dropped to #', () => {
  const out = renderMarkdown('[bad](javascript:alert(1))');
  assert.match(out, /href="#"/);
  assert.doesNotMatch(out, /javascript:/);
});

test('renderMarkdown: tag renders as styled span', () => {
  const out = renderMarkdown('a #note here');
  assert.match(out, /<span class="vault-tag">#note<\/span>/);
});

test('renderMarkdown: empty input returns empty string', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('renderMarkdown: raw <script> tag is escaped, never executed', () => {
  const out = renderMarkdown('Hi <script>alert(1)</script> ok.');
  assert.match(out, /&lt;script&gt;/);
  assert.doesNotMatch(out, /<script>/);
});
