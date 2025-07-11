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

function findCommandStartIndex(argv) {
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
      return i;
    }

    if (arg.startsWith('--')) {
      const optionName = arg.slice(2);
      if (optionsWithValues.has(optionName)) {
        i++;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const optionName = arg.slice(1);
      if (optionsWithValues.has(optionName)) {
        i++;
      }
    }
  }

  return -1;
}

function parseRawArguments(argv) {
  const commandStartIndex = findCommandStartIndex(argv);
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
    return { values: parsed.values, positionals: commandArgs };
  } catch (error) {
    console.error('Error parsing arguments:', error.message);
    showUsage();
    process.exit(1);
  }
}

function validateArguments(values, positionals) {
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
}

function createPatternsFromValues(values) {
  const useStrings = Boolean(values.strings);
  const rawPatterns = (values.patterns || values.strings)
    .split(',')
    .map((pattern) => pattern.trim());

  if (useStrings) {
    return rawPatterns.map((string) => ({
      type: 'string',
      value: string.toLowerCase()
    }));
  }

  return rawPatterns.map((pattern) => {
    try {
      return { type: 'regex', value: new RegExp(pattern, 'i') };
    } catch {
      const escapedPattern = pattern.replaceAll(
        /[.*+?^${}()|[\]\\]/g,
        String.raw`\$&`
      );
      console.warn(
        `Warning: Invalid regex pattern '${pattern}', treating as literal string`
      );
      return { type: 'regex', value: new RegExp(escapedPattern, 'i') };
    }
  });
}

export function parseArguments(argv) {
  const { values, positionals } = parseRawArguments(argv);
  validateArguments(values, positionals);
  const patterns = createPatternsFromValues(values);

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
    const executable = parts[0];
    const executableArgs = [...parts.slice(1), ...args];

    const stdio = options.captureOutput
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'inherit', 'inherit'];

    const child = spawn(executable, executableArgs, {
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

function createOutputBuffer() {
  let outputBuffer = '';
  let errorBuffer = '';
  let actionOutputBuffer = '';
  let actionErrorBuffer = '';

  return {
    appendOutput(data) {
      const output = data.toString();
      outputBuffer += output;
      return output;
    },
    appendError(data) {
      const output = data.toString();
      errorBuffer += output;
      return output;
    },
    getOutput: () => outputBuffer,
    getError: () => errorBuffer,
    addToOutput(text) {
      actionOutputBuffer += text;
    },
    addToError(text) {
      actionErrorBuffer += text;
    },
    getActionOutput: () => actionOutputBuffer,
    getActionError: () => actionErrorBuffer
  };
}

async function executeActionsWhenPatternsFound(config, buffer) {
  if (config.message) {
    buffer.addToOutput(config.message + '\n');
  }

  if (config.runCommand) {
    try {
      const { stdout, stderr } = await executeCommand(config.runCommand, [], {
        captureOutput: true
      });
      if (stdout) buffer.addToOutput(stdout);
      if (stderr) buffer.addToError(stderr);
    } catch (error) {
      console.error('Failed to execute run command:', error.message);
    }
  }

  if (config.npmScript) {
    try {
      const { stdout, stderr } = await executeCommand(
        `npm run -s ${config.npmScript}`,
        [],
        {
          captureOutput: true
        }
      );
      if (stdout) buffer.addToOutput(stdout);
      if (stderr) buffer.addToError(stderr);
    } catch (error) {
      console.error('Failed to execute npm script:', error.message);
    }
  }
}

function setupSignalHandling(childProcess) {
  const handleSignal = (signal) => {
    childProcess.kill(signal);
    setTimeout(() => {
      const exitCode = signal === 'SIGINT' ? 130 : 143;
      process.exit(exitCode);
    }, 500);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

function handleChildProcessError(error, buffer) {
  buffer.addToError('Failed to start command: ' + error.message + '\n');
  process.stdout.write(buffer.getOutput());
  process.stderr.write(buffer.getError());
  process.exit(1);
}

function determineExitCode(childExitCode) {
  if (childExitCode !== 0 && childExitCode !== undefined) {
    return 1;
  }

  return 0;
}

async function finalizeOutput(buffer, exitCode) {
  // Only write additional output from actions, not the original command output
  // since that was already forwarded in real-time
  const additionalOutput = buffer.getActionOutput();
  const additionalError = buffer.getActionError();

  if (additionalOutput) {
    process.stdout.write(additionalOutput);
  }

  if (additionalError) {
    process.stderr.write(additionalError);
  }

  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  process.exit(exitCode);
}

export async function run(args = process.argv.slice(2)) {
  const config = parseArguments(args);
  const patternMatcher = createPatternMatcher(config);
  const buffer = createOutputBuffer();
  let allPatternsFound = false;

  const child = spawn(config.command, config.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout.on('data', (data) => {
    const output = buffer.appendOutput(data);
    process.stdout.write(output);
    const allFound = patternMatcher.checkPatterns(output);
    if (allFound && !allPatternsFound) {
      allPatternsFound = true;
    }
  });

  child.stderr.on('data', (data) => {
    const output = buffer.appendError(data);
    process.stderr.write(output);
    const allFound = patternMatcher.checkPatterns(output);
    if (allFound && !allPatternsFound) {
      allPatternsFound = true;
    }
  });

  child.on('error', (error) => {
    handleChildProcessError(error, buffer);
  });

  child.on('exit', async (code) => {
    if (allPatternsFound) {
      await executeActionsWhenPatternsFound(config, buffer);
    }

    // Handle command not found scenarios across different platforms
    // On Unix systems, 127 typically means command not found
    // On Windows, different exit codes may be used
    if (code !== 0 && code !== undefined && (code === 127 || code === 1)) {
      buffer.addToError('Failed to start command: Command not found\n');
    }

    const exitCode = determineExitCode(code);
    await finalizeOutput(buffer, exitCode);
  });

  setupSignalHandling(child);
}
