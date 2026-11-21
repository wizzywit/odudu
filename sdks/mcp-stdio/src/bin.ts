#!/usr/bin/env node
import { usageText } from '#/services/mcp-options';
import { runMcp } from '#/run-mcp';
import { processMcpIo } from '#/process-io';

const argv = process.argv.slice(2);
if (argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(`${usageText()}\n`);
  process.exit(0);
}
process.exit(await runMcp(processMcpIo(), argv));
