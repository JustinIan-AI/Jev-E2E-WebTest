#!/usr/bin/env node
// IDWTH CLI shim -> built output. Run `npm run build` first.
import { main } from '../dist/cli/index.js';

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`idwth failed to start: ${err?.message ?? err}\n`);
    process.exit(4);
  });
