#!/usr/bin/env bun

import { run } from './cli.ts';

const exitCode = await run();
process.exit(exitCode);
