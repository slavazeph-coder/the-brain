// Compatibility entry point for read-only glass checks. The full suite lives in native.mjs.
process.argv.push('--readonly');
await import('./native.mjs');
