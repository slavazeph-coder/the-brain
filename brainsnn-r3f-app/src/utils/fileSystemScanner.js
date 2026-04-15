/**
 * File System Scanner
 *
 * Scans the actual project directory structure to build a real
 * knowledge inventory. Works in two modes:
 *
 * 1. Browser mode: user pastes `find` or `ls -R` output
 * 2. Claude Code mode: generates the scan command for the host
 *
 * Parses file paths, extracts metadata, and feeds into knowledgeScanner.
 */

import { classifyContent, KNOWLEDGE_DOMAINS } from '../data/knowledgeGraph';

// ---------- Parse tree/find output ----------

/**
 * Parse output of `find . -name "*.md" -o -name "*.js" ...` or similar.
 */
export function parseTreeOutput(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const documents = [];

  for (const line of lines) {
    // Skip directory-only lines
    if (line.endsWith('/') || line.endsWith(':')) continue;
    // Skip common non-content files
    if (/\.(png|jpg|gif|ico|woff|ttf|lock|map)$/i.test(line)) continue;
    if (/node_modules|\.git\/|dist\/|build\/|\.cache/.test(line)) continue;

    const path = line.replace(/^\.\//, '');
    const filename = path.split('/').pop() || path;
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const nameNoExt = filename.replace(/\.\w+$/, '');

    // Extract title from filename
    const title = nameNoExt
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    // Use path components for better classification
    const pathContext = path.replace(/[/\\._-]/g, ' ');
    const content = `${title} ${pathContext} ${ext}`;

    documents.push({
      path,
      title,
      content,
      ext,
      lastModified: Date.now(), // can't determine from tree output
      tags: extractTags(path, ext)
    });
  }

  return documents;
}

function extractTags(path, ext) {
  const tags = [];
  const lower = path.toLowerCase();

  // Extension-based tags
  const extMap = {
    js: ['javascript', 'code'], jsx: ['react', 'code'], ts: ['typescript', 'code'],
    tsx: ['react', 'typescript', 'code'], py: ['python', 'code'],
    md: ['documentation', 'markdown'], json: ['config', 'data'],
    yaml: ['config'], yml: ['config'], toml: ['config'],
    css: ['styles', 'frontend'], html: ['frontend'],
    sql: ['database'], sh: ['script', 'automation'],
    dockerfile: ['docker', 'infrastructure']
  };
  if (extMap[ext]) tags.push(...extMap[ext]);

  // Path-based tags
  if (lower.includes('test') || lower.includes('spec')) tags.push('testing');
  if (lower.includes('doc') || lower.includes('readme')) tags.push('documentation');
  if (lower.includes('config') || lower.includes('.env')) tags.push('configuration');
  if (lower.includes('server') || lower.includes('api')) tags.push('backend', 'api');
  if (lower.includes('component') || lower.includes('src/')) tags.push('frontend');
  if (lower.includes('util') || lower.includes('helper')) tags.push('utility');
  if (lower.includes('hook')) tags.push('react-hooks');
  if (lower.includes('model') || lower.includes('schema')) tags.push('data-model');
  if (lower.includes('deploy') || lower.includes('ci')) tags.push('devops');
  if (lower.includes('security') || lower.includes('auth')) tags.push('security');

  return [...new Set(tags)];
}

// ---------- Obsidian vault parser ----------

/**
 * Parse an Obsidian vault export (JSON or file list with frontmatter hints).
 * Obsidian files typically have YAML frontmatter with tags.
 */
export function parseObsidianExport(text) {
  // Try JSON first
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        path: item.path || item.file || '',
        title: item.title || item.name || item.path?.split('/').pop()?.replace('.md', '') || '',
        content: [item.content, item.title, item.tags?.join(' ')].filter(Boolean).join(' '),
        lastModified: item.modified || item.mtime || Date.now(),
        tags: item.tags || item.frontmatter?.tags || []
      }));
    }
  } catch {
    // Not JSON, treat as file list
  }

  // Parse as markdown file list with optional frontmatter hints
  return parseTreeOutput(text);
}

// ---------- Generate scan command ----------

/**
 * Generate a shell command that Claude Code can run to scan the workspace.
 */
export function generateScanCommand(rootDir = '.') {
  return `find ${rootDir} -type f \\( -name "*.md" -o -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.py" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.css" -o -name "*.html" -o -name "*.sql" -o -name "*.sh" \\) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/__pycache__/*" | sort`;
}

// ---------- Build domain summary from real scan ----------

export function summarizeScan(documents) {
  const domainCounts = {};
  const domainTags = {};

  for (const [id] of Object.entries(KNOWLEDGE_DOMAINS)) {
    domainCounts[id] = 0;
    domainTags[id] = new Set();
  }

  for (const doc of documents) {
    const { primary } = classifyContent(doc.content);
    if (primary) {
      domainCounts[primary]++;
      for (const tag of (doc.tags || [])) {
        domainTags[primary].add(tag);
      }
    }
  }

  return {
    totalFiles: documents.length,
    domainCounts,
    domainTags: Object.fromEntries(
      Object.entries(domainTags).map(([k, v]) => [k, [...v]])
    ),
    fileTypes: countByExtension(documents)
  };
}

function countByExtension(documents) {
  const counts = {};
  for (const doc of documents) {
    const ext = doc.ext || 'other';
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
