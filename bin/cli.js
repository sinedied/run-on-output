#!/usr/bin/env node
import process from 'node:process';
import { run } from '../run-on-output.js';

try {
  await run();
} catch (error) {
  console.error('[ERROR] run-on-output failed:', error.message);
  process.exit(1);
}
