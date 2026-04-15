/**
 * Layer 20 — Regex-based code parser
 *
 * Cannibalized from GitNexus's Tree-sitter AST extraction pattern,
 * simplified to pure-regex so we don't add a WASM dependency. Handles
 * JS/TS/Python/Go/Rust function + class + import + export extraction.
 * Returns symbols that can be fed into BM25 index + community detection
 * to build a code-aware knowledge graph.
 */

const LANG_PATTERNS = {
  js: {
    ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i,
    // Matches: function foo(, const foo = (, class Foo, export function foo
    symbols: [
      { kind: 'function', re: /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)\s*\(/g, name: 1 },
      { kind: 'function', re: /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^=]*?\)?\s*=>/g, name: 1 },
      { kind: 'class', re: /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z_$][\w$]*)/g, name: 1 },
      { kind: 'interface', re: /(?:^|\n)\s*(?:export\s+)?interface\s+([a-zA-Z_$][\w$]*)/g, name: 1 },
      { kind: 'type', re: /(?:^|\n)\s*(?:export\s+)?type\s+([a-zA-Z_$][\w$]*)\s*=/g, name: 1 }
    ],
    imports: /(?:^|\n)\s*import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/g,
    exports: /(?:^|\n)\s*export\s+(?:default\s+)?(?:function\s+|class\s+|const\s+|let\s+|var\s+)?([a-zA-Z_$][\w$]*)/g
  },
  py: {
    ext: /\.py$/i,
    symbols: [
      { kind: 'function', re: /(?:^|\n)\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/g, name: 1 },
      { kind: 'class', re: /(?:^|\n)\s*class\s+([a-zA-Z_]\w*)/g, name: 1 }
    ],
    imports: /(?:^|\n)\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g,
    exports: /(?:^|\n)\s*(?:def|class)\s+([a-zA-Z_]\w*)/g
  },
  go: {
    ext: /\.go$/i,
    symbols: [
      { kind: 'function', re: /(?:^|\n)func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Z]\w*)/g, name: 1 },
      { kind: 'type', re: /(?:^|\n)type\s+([A-Z]\w*)\s+(?:struct|interface)/g, name: 1 }
    ],
    imports: /import\s+(?:"([^"]+)"|\(([^)]+)\))/g,
    exports: /(?:^|\n)(?:func|type)\s+([A-Z]\w*)/g
  },
  rust: {
    ext: /\.rs$/i,
    symbols: [
      { kind: 'function', re: /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_]\w*)/g, name: 1 },
      { kind: 'struct', re: /(?:^|\n)\s*(?:pub\s+)?struct\s+([a-zA-Z_]\w*)/g, name: 1 },
      { kind: 'enum', re: /(?:^|\n)\s*(?:pub\s+)?enum\s+([a-zA-Z_]\w*)/g, name: 1 },
      { kind: 'trait', re: /(?:^|\n)\s*(?:pub\s+)?trait\s+([a-zA-Z_]\w*)/g, name: 1 }
    ],
    imports: /(?:^|\n)\s*use\s+([\w:]+)/g,
    exports: /(?:^|\n)\s*pub\s+(?:fn|struct|enum|trait|mod)\s+([a-zA-Z_]\w*)/g
  }
};

function detectLang(path) {
  if (!path) return 'js';
  for (const [lang, config] of Object.entries(LANG_PATTERNS)) {
    if (config.ext.test(path)) return lang;
  }
  return 'js';
}

/**
 * Parse a single file's source code.
 * Returns { path, lang, symbols: [{kind, name, line}], imports: [], exports: [] }
 */
export function parseFile(path, source) {
  const lang = detectLang(path);
  const config = LANG_PATTERNS[lang];
  const symbols = [];
  const imports = new Set();
  const exports = new Set();

  if (!source || !config) {
    return { path, lang, symbols: [], imports: [], exports: [] };
  }

  for (const pattern of config.symbols) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(source))) {
      const name = m[pattern.name];
      if (!name) continue;
      const line = source.slice(0, m.index).split('\n').length;
      symbols.push({ kind: pattern.kind, name, line });
    }
  }

  config.imports.lastIndex = 0;
  let m;
  while ((m = config.imports.exec(source))) {
    const mod = m[1] || m[2];
    if (mod) imports.add(mod.trim());
  }

  if (config.exports) {
    config.exports.lastIndex = 0;
    while ((m = config.exports.exec(source))) {
      if (m[1]) exports.add(m[1]);
    }
  }

  return {
    path,
    lang,
    symbols,
    imports: Array.from(imports),
    exports: Array.from(exports)
  };
}

/**
 * Parse multiple files (expected from `files` array of {path, source}).
 * Returns a knowledge graph ready for community detection + BM25 search.
 */
export function parseFiles(files) {
  const parsed = files.map(({ path, source }) => parseFile(path, source));

  // Build nodes: files + symbols
  const nodes = [];
  const nodeIds = new Set();

  for (const f of parsed) {
    const fileId = `file:${f.path}`;
    nodes.push({
      id: fileId,
      kind: 'file',
      label: f.path.split('/').pop(),
      path: f.path,
      lang: f.lang,
      symbolCount: f.symbols.length
    });
    nodeIds.add(fileId);

    for (const sym of f.symbols) {
      const symId = `${sym.kind}:${f.path}:${sym.name}`;
      if (nodeIds.has(symId)) continue;
      nodeIds.add(symId);
      nodes.push({
        id: symId,
        kind: sym.kind,
        label: sym.name,
        path: f.path,
        line: sym.line
      });
    }
  }

  // Build edges:
  //  - file → symbol (contains)
  //  - file → file (via import resolution — best-effort by basename)
  //  - symbol → symbol (sibling within file, weak)
  const edges = [];
  const fileByBasename = new Map();
  for (const f of parsed) {
    const base = f.path.split('/').pop().replace(/\.[^.]+$/, '');
    fileByBasename.set(base, f.path);
  }

  for (const f of parsed) {
    const fileId = `file:${f.path}`;
    for (const sym of f.symbols) {
      edges.push({ source: fileId, target: `${sym.kind}:${f.path}:${sym.name}`, weight: 1 });
    }
    // Imports (best-effort resolution)
    for (const imp of f.imports) {
      const base = imp.split('/').pop().replace(/\.[^.]+$/, '');
      const resolved = fileByBasename.get(base);
      if (resolved && resolved !== f.path) {
        edges.push({ source: fileId, target: `file:${resolved}`, weight: 2 });
      }
    }
    // Sibling symbols within same file
    for (let i = 0; i < f.symbols.length - 1; i++) {
      const a = `${f.symbols[i].kind}:${f.path}:${f.symbols[i].name}`;
      const b = `${f.symbols[i + 1].kind}:${f.path}:${f.symbols[i + 1].name}`;
      edges.push({ source: a, target: b, weight: 0.3 });
    }
  }

  // Build BM25 document corpus: one doc per symbol (uses name + path as text)
  const docs = nodes.map((n) => ({
    id: n.id,
    text: `${n.label} ${n.kind} ${n.path || ''} ${n.lang || ''}`,
    meta: n
  }));

  const stats = {
    totalFiles: parsed.length,
    totalSymbols: nodes.filter((n) => n.kind !== 'file').length,
    byKind: nodes.reduce((acc, n) => {
      acc[n.kind] = (acc[n.kind] || 0) + 1;
      return acc;
    }, {}),
    byLang: parsed.reduce((acc, f) => {
      acc[f.lang] = (acc[f.lang] || 0) + 1;
      return acc;
    }, {})
  };

  return { nodes, edges, docs, files: parsed, stats };
}
