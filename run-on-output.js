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
  -n, --npm <script>           npm script to run after all patterns are found
  -m, --message <text>         Message to display after all patterns are found
  -h, --help                   Show this help message

NOTES:
  - Either --patterns or --strings must be specified (but not both)
  - At least one of --run, --npm, or --message must be specified
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
  run-on-output -s "ready" -m "Server is up" -r "open http://localhost:3000" npm start

  # Run npm script when server is ready
  run-on-output -s "Server running" -n "test" node server.js

  # Combine all actions
  run-on-output -s "ready" -m "All ready!" -r "curl localhost:3000" -n "deploy" npm start`);
}

// eslint-disable-next-line complexity
export function parseArguments(argv) {
  // Find the first argument that doesn't start with '-' and isn't a value for an option
  let commandStartIndex = -1;
  const optionsWithValues = new Set([
    'p',
    'patterns',
    's',
    'strings',
    'r',
    'run',
    'n',
    'npm',
    'm',
    'message'
  ]);

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

  let values;
  let positionals;

  // Parse only up to the command start
  const argsToParse =
    commandStartIndex === -1 ? argv : argv.slice(0, commandStartIndex);
  const commandArgs =
    commandStartIndex === -1 ? [] : argv.slice(commandStartIndex);

  try {
    const parsed = parseArgs({
      args: argsToParse,
      options: {
        patterns: { type: 'string', short: 'p' },
        strings: { type: 'string', short: 's' },
        run: { type: 'string', short: 'r' },
        npm: { type: 'string', short: 'n' },
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

  if (!values.run && !values.npm && !values.message) {
    console.error('Error: either --run, --npm, or --message is required');
    showUsage();
    process.exit(1);
  }

  const useStrings = Boolean(values.strings);
  const rawPatterns = (values.patterns || values.strings)
    .split(',')
    .map((p) => p.trim());

  let patterns;
  if (useStrings) {
    patterns = rawPatterns.map((s) => ({
      type: 'string',
      value: s.toLowerCase()
    }));
  } else {
    patterns = rawPatterns.map((p) => {
      try {
        return { type: 'regex', value: new RegExp(p, 'i') };
      } catch {
        // Create a regex that matches the pattern literally
        const escapedPattern = p.replaceAll(
          /[.*+?^${}()|[\]\\]/g,
          String.raw`\$&`
        );
        console.warn(
          `Warning: Invalid regex pattern '${p}', treating as literal string`
        );
        return { type: 'regex', value: new RegExp(escapedPattern, 'i') };
      }
    });
  }

  return {
    patterns,
    runCommand: values.run,
    npmScript: values.npm,
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

    const stdio = options.captureOutput
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'inherit', 'inherit'];

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
        if (typeof options.onStdout === 'function') {
          options.onStdout(output);
        } else {
          process.stdout.write(output);
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        if (typeof options.onStderr === 'function') {
          options.onStderr(output);
        } else {
          process.stderr.write(output);
        }
      });
    }

    child.on('error', (error) => {
      const errorMessage = `Command failed: ${error.message}`;
      if (options.captureOutput) {
        console.error(errorMessage);
      }

      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const errorMessage = `Command failed: exit code ${code}`;
        if (options.captureOutput) {
          console.error(errorMessage);
        }

        reject(new Error(errorMessage));
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
      const isMatch =
        pattern.type === 'string'
          ? output.toLowerCase().includes(pattern.value)
          : pattern.value.test(output);

      if (isMatch) {
        const patternKey =
          pattern.type === 'string' ? pattern.value : pattern.value.source;
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

export async function run(args = process.argv.slice(2)) {
  const config = parseArguments(args);
  const patternMatcher = createPatternMatcher(config);
  let outputBuffer = '';
  let errorBuffer = '';
  let allPatternsFound = false;

  function appendOutput(data) {
    const output = data.toString();
    outputBuffer += output;
    return output;
  }

  function appendError(data) {
    const output = data.toString();
    errorBuffer += output;
    return output;
  }

  async function checkOutput(data) {
    const output = appendOutput(data);
    const allFound = patternMatcher.checkPatterns(output);
    if (allFound && !allPatternsFound) {
      allPatternsFound = true;
    }
  }

  const child = spawn(config.command, config.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout.on('data', checkOutput);
  child.stderr.on('data', (data) => {
    appendError(data);
    checkOutput(data);
  });

  child.on('error', (error) => {
    errorBuffer += 'Failed to start command: ' + error.message + '\n';
    process.stdout.write(outputBuffer);
    process.stderr.write(errorBuffer);
    process.exit(1);
  });

  child.on('exit', async (code, _signal) => {
    let exitCode = 0;
    if (allPatternsFound) {
      if (config.message) {
        outputBuffer += config.message + '\n';
      }

      if (config.runCommand) {
        try {
          const { stdout, stderr } = await executeCommand(
            config.runCommand,
            [],
            { captureOutput: true }
          );
          if (stdout) outputBuffer += stdout;
          if (stderr) errorBuffer += stderr;
        } catch {
          // Error already logged
        }
      }

      if (config.npmScript) {
        try {
          const { stdout, stderr } = await executeCommand(
            `npm run -s ${config.npmScript}`,
            [],
            { captureOutput: true }
          );
          if (stdout) outputBuffer += stdout;
          if (stderr) errorBuffer += stderr;
        } catch {
          // Error already logged
        }
      }
    }

    if (code !== 0 && code !== undefined && code === 127) {
      errorBuffer += 'Failed to start command: Command not found\n';
      exitCode = 1;
    }

    process.stdout.write(outputBuffer);
    process.stderr.write(errorBuffer);

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    process.exit(exitCode);
  });

  // Handle process termination
  process.on('SIGINT', () => {
    // Forward SIGINT to child and wait for it to exit, then exit self
    child.kill('SIGINT');
    setTimeout(() => {
      process.exit(130); // 128 + SIGINT
    }, 500);
  });

  process.on('SIGTERM', () => {
    child.kill('SIGTERM');
    setTimeout(() => {
      process.exit(143); // 128 + SIGTERM
    }, 500);
  });
}
