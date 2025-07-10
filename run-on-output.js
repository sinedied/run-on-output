#!/usr/bin/env node

import process from 'node:process';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

function showUsage() {
  console.log(`run-on-output - Execute tasks when CLI output patterns are detected

USAGE:
  run-on-output [OPTIONS] <command> [args...]

DESCRIPTION:
  Runs a command and monitors its output (stdout/stderr) for specified patterns.
  When all patterns are found, executes an action (run command or show message).

OPTIONS:
  -p, --patterns <patterns>    Comma-separated list of regex patterns to watch for
  -s, --strings <strings>      Comma-separated list of plain strings to watch for
  -r, --run <command>          Command to execute after all patterns are found
  -m, --message <text>         Message to display after all patterns are found
  -h, --help                   Show this help message

NOTES:
  - Either --patterns or --strings must be specified (but not both)
  - At least one of --run or --message must be specified
  - Patterns/strings are matched case-insensitively
  - Output is forwarded in real-time while monitoring
  - Both stdout and stderr are monitored for patterns

EXAMPLES:
  # Display message when services are ready (using plain strings)
  run-on-output -s "Server started,Database connected" -m "All services ready!" npm start

  # Execute command when server is listening (using regex)
  run-on-output -p "listening on port \\d+" -r "curl http://localhost:3000/health" node server.js

  # Monitor development environment startup (using plain strings)
  run-on-output -s "webpack compiled,server ready" -m "Development environment ready" npm run dev

  # Multiple actions
  run-on-output -s "ready" -m "Server is up" -r "open http://localhost:3000" npm start`);
}

function parseArguments() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        patterns: { type: 'string', short: 'p' },
        strings: { type: 'string', short: 's' },
        run: { type: 'string', short: 'r' },
        message: { type: 'string', short: 'm' },
        help: { type: 'boolean', short: 'h' }
      },
      allowPositionals: true
    });

    if (values.help) {
      showUsage();
      process.exit(0);
    }

    if (!values.patterns && !values.strings) {
      console.error('Error: either --patterns or --strings is required');
      showUsage();
      process.exit(1);
    }

    if (values.patterns && values.strings) {
      console.error('Error: cannot use both --patterns and --strings together');
      showUsage();
      process.exit(1);
    }

    if (positionals.length === 0) {
      console.error('Error: command to run is required');
      showUsage();
      process.exit(1);
    }

    if (!values.run && !values.message) {
      console.error('Error: either --run or --message is required');
      showUsage();
      process.exit(1);
    }

    const useStrings = Boolean(values.strings);
    const rawPatterns = (values.patterns || values.strings).split(',').map(p => p.trim());

    return {
      patterns: useStrings
        ? rawPatterns.map(s => ({ type: 'string', value: s.toLowerCase() }))
        : rawPatterns.map(p => ({ type: 'regex', value: new RegExp(p, 'i') })),
      runCommand: values.run,
      message: values.message,
      command: positionals[0],
      args: positionals.slice(1)
    };
  } catch (error) {
    console.error('Error parsing arguments:', error.message);
    showUsage();
    process.exit(1);
  }
}

async function executeCommand(command, args) {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const cmdArgs = [parts.slice(1), ...args];

    const child = spawn(cmd, cmdArgs, {
      shell: true,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const config = parseArguments();

  const foundPatterns = new Set();
  let allPatternsFound = false;

  const child = spawn(config.command, config.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  async function checkOutput(data) {
    const output = data.toString();
    process.stdout.write(output); // Forward output to console

    if (allPatternsFound) return;

    // Check each pattern against the output
    for (const pattern of config.patterns) {
      const isMatch = pattern.type === 'string'
        ? output.toLowerCase().includes(pattern.value)
        : pattern.value.test(output);

      if (isMatch) {
        const patternKey = pattern.type === 'string' ? pattern.value : pattern.value.source;
        foundPatterns.add(patternKey);
      }
    }

    // Check if all patterns have been found
    if (foundPatterns.size === config.patterns.length && !allPatternsFound) {
      allPatternsFound = true;

      if (config.message) {
        console.log(config.message);
      }

      if (config.runCommand) {
        try {
          await executeCommand(config.runCommand, []);
        } catch (error) {
          console.error('[ERROR] Command failed:', error.message);
        }
      }
    }
  }

  child.stdout.on('data', checkOutput);
  child.stderr.on('data', async (data) => {
    process.stderr.write(data); // Forward stderr to console
    await checkOutput(data); // Also check stderr for patterns
  });

  child.on('error', (error) => {
    console.error('[ERROR] Failed to start command:', error.message);
    process.exit(1);
  });

  child.on('exit', (code, _signal) => {
    process.exit(code || 0);
  });

  // Handle process termination
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

try {
  await main();
} catch (error) {
  console.error('[ERROR] run-on-output failed:', error.message);
  process.exit(1);
}
