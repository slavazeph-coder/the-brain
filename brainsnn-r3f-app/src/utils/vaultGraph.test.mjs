import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLinkGraph,
  backlinksFor,
  forwardLinksFor,
  tagIndex,
  layoutGraph,
} from './vaultGraph.js';

const NOTES = [
  { id: 'a', title: 'A', body: 'Goes to [[B]] and [[c]].', tags: ['x'] },
  { id: 'b', title: 'B', body: '[[A|aliased]]' },
  { id: 'c', title: 'C', body: 'no links' },
  { id: 'd', title: 'D', body: '[[Missing]]' },
];

test('buildLinkGraph: nodes mirror notes count', () => {
  const g = buildLinkGraph(NOTES);
  assert.equal(g.nodes.length, 4);
});

test('buildLinkGraph: edges include resolved wikilinks only', () => {
  const g = buildLinkGraph(NOTES);
  const pairs = g.edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(pairs, ['a->b', 'a->c', 'b->a']);
});

test('buildLinkGraph: missing wikilinks are reported', () => {
  const g = buildLinkGraph(NOTES);
  assert.equal(g.missing.length, 1);
  assert.equal(g.missing[0].target, 'Missing');
});

test('buildLinkGraph: in/out degrees populated', () => {
  const g = buildLinkGraph(NOTES);
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.a.out, 2);
  assert.equal(byId.a.in, 1);
  assert.equal(byId.b.out, 1);
  assert.equal(byId.b.in, 1);
  assert.equal(byId.c.in, 1);
  assert.equal(byId.d.out, 0);
});

test('backlinksFor: returns sources that link to the target', () => {
  const back = backlinksFor(NOTES, 'b');
  assert.equal(back.length, 1);
  assert.equal(back[0].from, 'a');
  assert.equal(back[0].target, 'B');
});

test('backlinksFor: empty array for note with no incoming links', () => {
  assert.deepEqual(backlinksFor(NOTES, 'd'), []);
});

test('forwardLinksFor: returns resolved targets', () => {
  const fwd = forwardLinksFor(NOTES, 'a');
  const tos = fwd.map((f) => f.to).sort();
  assert.deepEqual(tos, ['b', 'c']);
});

test('forwardLinksFor: missing target excluded (only resolved edges shown)', () => {
  const fwd = forwardLinksFor(NOTES, 'd');
  assert.deepEqual(fwd, []);
});

test('tagIndex: merges explicit + body #tags', () => {
  const idx = tagIndex([
    { id: 'a', title: 'A', body: '#foo', tags: ['bar'] },
    { id: 'b', title: 'B', body: '#foo and #bar', tags: [] },
  ]);
  assert.deepEqual(idx.foo.sort(), ['a', 'b']);
  assert.deepEqual(idx.bar.sort(), ['a', 'b']);
});

test('layoutGraph: every node gets x,y in [0,1]', () => {
  const g = buildLinkGraph(NOTES);
  const laid = layoutGraph(g, { iterations: 50 });
  for (const n of laid.nodes) {
    const p = laid.layout[n.id];
    assert.ok(p, `no layout for ${n.id}`);
    assert.ok(p.x >= 0 && p.x <= 1, `x out of range for ${n.id}: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 1, `y out of range for ${n.id}: ${p.y}`);
  }
});

test('layoutGraph: empty graph does not throw', () => {
  const laid = layoutGraph({ nodes: [], edges: [] }, { iterations: 50 });
  assert.deepEqual(laid.layout, {});
});

test('buildLinkGraph: case-insensitive title resolution', () => {
  const notes = [
    { id: 'foo', title: 'Foo', body: '[[foo]]' },
    { id: 'bar', title: 'Bar', body: '[[FOO]]' },
  ];
  const g = buildLinkGraph(notes);
  const pairs = g.edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(pairs, ['bar->foo', 'foo->foo']);
});
