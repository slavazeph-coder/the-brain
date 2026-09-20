'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('public/index.html');
const css = read('public/midnight.css');
const app = read('public/app.js');

function luminance(hex) {
  const c = hex.replace('#', '').match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function contrast(a, b) { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

test('XIO midnight is applied before paint and after the layout stylesheet', () => {
  assert.match(html, /name="theme-color" content="#06111f"/);
  assert.match(html, /data-design-version="xio-midnight-v1" data-theme="midnight"/);
  assert.ok(html.indexOf('/sponsor/midnight.css') > html.indexOf('/sponsor/flow.css'));
  assert.ok(html.indexOf('/sponsor/midnight.css') < html.indexOf('</head>'));
  assert.match(app, /dark:document\.body\.dataset\.theme==='midnight'/);
  assert.match(css, /color-scheme:\s*dark/);
});

test('XIO source palette remains local to sponsorship styling', () => {
  for (const color of ['#06111f', '#0d1d30', '#6ce2eb', '#aeb9c7']) assert.ok(css.includes(color));
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.ok(css.includes('.sponsor-page .application-dialog'));
  assert.ok(css.includes('.sponsor-page .config-step'));
  assert.ok(css.includes('.sponsor-page .nav nav'));
});

test('primary text, muted text and cyan button text have strong palette contrast', () => {
  for (const [foreground, background] of [['#f7f9fc','#06111f'],['#aeb9c7','#06111f'],['#aeb9c7','#0d1d30'],['#06111f','#6ce2eb'],['#b4c2d3','#0a1829']]) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background}`);
  }
});
