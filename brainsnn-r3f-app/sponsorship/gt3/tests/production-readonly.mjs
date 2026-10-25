// Public acceptance never sends a production design or payment.
process.argv.push('--live','--readonly');
await import('./native.mjs');
