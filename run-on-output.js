#!/usr/bin/env node

import process from 'node:process';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

export function showUsage() {
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

export function parseArguments(argv = process.argv.slice(2)) {
  // Find the first argument that doesn't start with '-' and isn't a value for an option
  let commandStartIndex = -1;
  const optionsWithValues = new Set(['p', 'patterns', 's', 'strings', 'r', 'run', 'm', 'message']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      commandStartIndex = i;
      break;
    }

    // Skip the next argument if this option takes a value
    if (arg.startsWith('--')) {
      const optName = arg.slice(2);
      if (optionsWithValues.has(optName)) {
        i++; // Skip the value
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Handle short options like -s, -p, etc.
      const optName = arg.slice(1);
      if (optionsWithValues.has(optName)) {
        i++; // Skip the value
      }
    }
  }

  let values, positionals;

  // Parse only up to the command start
  const argsToParse = commandStartIndex === -1 ? argv : argv.slice(0, commandStartIndex);
  const commandArgs = commandStartIndex === -1 ? [] : argv.slice(commandStartIndex);

  try {
    const parsed = parseArgs({
      args: argsToParse,
      options: {
        patterns: { type: 'string', short: 'p' },
        strings: { type: 'string', short: 's' },
        run: { type: 'string', short: 'r' },
        message: { type: 'string', short: 'm' },
        help: { type: 'boolean', short: 'h' }
      },
      allowPositionals: false
    });
    values = parsed.values;
    positionals = commandArgs;
  } catch (error) {
    console.error('Error parsing arguments:', error.message);
    showUsage();
    process.exit(1);
  }

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

  let patterns;
  if (useStrings) {
    patterns = rawPatterns.map(s => ({ type: 'string', value: s.toLowerCase() }));
  } else {
    patterns = rawPatterns.map(p => {
      try {
        return { type: 'regex', value: new RegExp(p, 'i') };
      } catch (regexError) {
        // Create a regex that matches the pattern literally
        const escapedPattern = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        console.warn(`Warning: Invalid regex pattern '${p}', treating as literal string`);
        return { type: 'regex', value: new RegExp(escapedPattern, 'i') };
      }
    });
  }

  return {
    patterns,
    runCommand: values.run,
    message: values.message,
    command: positionals[0],
    args: positionals.slice(1)
  };
}

export async function executeCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const parts = command.split(' ');
    const cmd = parts[0];
    const cmdArgs = [...parts.slice(1), ...args];

    const stdio = options.captureOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'];

    const child = spawn(cmd, cmdArgs, {
      shell: true,
      stdio
    });

    let stdout = '';
    let stderr = '';

    if (options.captureOutput) {
      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        process.stdout.write(output); // Forward to console
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        process.stderr.write(output); // Forward to console
      });
    }

    child.on('error', (error) => {
      const errorMsg = `Command failed: ${error.message}`;
      if (options.captureOutput) {
        console.error(errorMsg);
      }
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errorMsg = `Command failed: exit code ${code}`;
        if (options.captureOutput) {
          console.error(errorMsg);
        }
        reject(new Error(errorMsg));
      }
    });
  });
}

export function createPatternMatcher(config) {
  const foundPatterns = new Set();
  let allPatternsFound = false;

  function checkPatterns(output) {
    if (allPatternsFound) return false;

    for (const pattern of config.patterns) {
      const isMatch = pattern.type === 'string'
        ? output.toLowerCase().includes(pattern.value)
        : pattern.value.test(output);

      if (isMatch) {
        const patternKey = pattern.type === 'string' ? pattern.value : pattern.value.source;
        foundPatterns.add(patternKey);
      }
    }

    if (foundPatterns.size === config.patterns.length && !allPatternsFound) {
      allPatternsFound = true;
      return true;
    }

    return false;
  }

  return { checkPatterns, foundPatterns, isComplete: () => allPatternsFound };
}

async function main() {
  const config = parseArguments();
  const patternMatcher = createPatternMatcher(config);
  let runningActions = [];

  const child = spawn(config.command, config.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  async function checkOutput(data) {
    const output = data.toString();
    process.stdout.write(output); // Forward output to console

    const allFound = patternMatcher.checkPatterns(output);

    if (allFound) {
      if (config.message) {
        console.log(config.message);
      }

      if (config.runCommand) {
        const actionPromise = executeCommand(config.runCommand, [], { captureOutput: true })
          .catch(error => {
            // Error already logged in executeCommand
          });
        runningActions.push(actionPromise);
      }
    }
  }

  child.stdout.on('data', checkOutput);
  child.stderr.on('data', async (data) => {
    process.stderr.write(data); // Forward stderr to console
    await checkOutput(data); // Also check stderr for patterns
  });

  child.on('error', (error) => {
    console.error('Failed to start command:', error.message);
    process.exit(1);
  });

  child.on('exit', async (code, _signal) => {
    // Wait for all running actions to complete before exiting
    await Promise.allSettled(runningActions);

    // If the command failed to start or had an error, report it
    if (code !== 0 && code !== undefined) {
      // Check if this looks like a "command not found" error
      if (code === 127) {
        console.error('Failed to start command: Command not found');
        process.exit(1);
      }
    }

    // Exit successfully - we completed our monitoring task
    process.exit(0);
  });

  // Handle process termination
  process.on('SIGINT', () => {
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
  });
}

// Export for testing, but this file is not meant to be imported in production
export { main };

// CLI execution - this runs when file is executed directly
if (process.argv[1] && process.argv[1].endsWith('run-on-output.js')) {
  try {
    await main();
  } catch (error) {
    console.error('[ERROR] run-on-output failed:', error.message);
    process.exit(1);
  }
}
