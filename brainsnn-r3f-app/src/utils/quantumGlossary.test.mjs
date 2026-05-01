import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLOSSARY_TERMS,
  GLOSSARY_CATEGORY_LABEL,
  GLOSSARY_CATEGORY_COLOR,
  searchGlossary,
} from './quantumGlossary.js';

test('every term has the required fields', () => {
  for (const t of GLOSSARY_TERMS) {
    for (const k of ['term', 'category', 'plain', 'math', 'metaphor']) {
      assert.ok(typeof t[k] === 'string' && t[k].length > 0, `${t.term}: missing ${k}`);
    }
  }
});

test('every term category is a known category with a label and color', () => {
  for (const t of GLOSSARY_TERMS) {
    assert.ok(GLOSSARY_CATEGORY_LABEL[t.category], `${t.term}: unknown category ${t.category}`);
    assert.ok(GLOSSARY_CATEGORY_COLOR[t.category], `${t.term}: missing color for ${t.category}`);
  }
});

test('terms are unique by term name', () => {
  const seen = new Set();
  for (const t of GLOSSARY_TERMS) {
    assert.ok(!seen.has(t.term), `duplicate term: ${t.term}`);
    seen.add(t.term);
  }
});

test('searchGlossary: empty query returns everything', () => {
  const r = searchGlossary(GLOSSARY_TERMS, '');
  assert.equal(r.length, GLOSSARY_TERMS.length);
});

test('searchGlossary: substring query filters', () => {
  const r = searchGlossary(GLOSSARY_TERMS, 'Hadamard');
  assert.ok(r.length >= 1);
  assert.ok(r.every((t) => /hadamard/i.test(t.term + t.plain + t.math + t.metaphor)));
});

test('searchGlossary: category filter restricts results', () => {
  const r = searchGlossary(GLOSSARY_TERMS, '', 'gate');
  assert.ok(r.length >= 4);
  for (const t of r) assert.equal(t.category, 'gate');
});

test('searchGlossary: case-insensitive', () => {
  const r1 = searchGlossary(GLOSSARY_TERMS, 'BELL');
  const r2 = searchGlossary(GLOSSARY_TERMS, 'bell');
  assert.equal(r1.length, r2.length);
});

test('universal-primitive entry references arXiv 2603.21852', () => {
  const u = GLOSSARY_TERMS.find((t) => t.term === 'Universal gate set');
  assert.ok(u, 'Universal gate set entry missing');
  assert.ok(u.math.includes('2603.21852'), 'expected arXiv citation in math column');
  assert.ok(u.math.toLowerCase().includes('eml'), 'expected eml in math column');
});

test('all 5 categories are represented', () => {
  const cats = new Set(GLOSSARY_TERMS.map((t) => t.category));
  for (const k of Object.keys(GLOSSARY_CATEGORY_LABEL)) {
    assert.ok(cats.has(k), `no terms in category ${k}`);
  }
});
