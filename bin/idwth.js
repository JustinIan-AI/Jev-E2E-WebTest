#!/usr/bin/env node
// IDWTH CLI shim -> built output. Run `npm run build` first.
import('../dist/cli/index.js').catch((err) => {
  process.stderr.write(`idwth failed to start: ${err?.message ?? err}\n`);
  process.exit(4);
});
