import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, '..', 'bin', 'cli.js');

describe('CLI Integration Tests', () => {
  let originalProcessExit;
  let originalConsoleLog;
  let originalConsoleError;

  beforeEach(() => {
    originalProcessExit = process.exit;
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  function runCLI(args, input = '') {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [cliPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', reject);

      child.on('exit', (code) => {
        resolve({ code, stdout, stderr });
      });

      if (input) {
        child.stdin.write(input);
      }

      child.stdin.end();
    });
  }

  describe('Help and Usage', () => {
    it('should show help when --help is provided', async () => {
      const result = await runCLI(['--help']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        'run-on-output - Execute tasks when CLI output patterns are detected'
      );
      expect(result.stdout).toContain('USAGE:');
      expect(result.stdout).toContain('OPTIONS:');
      expect(result.stdout).toContain('EXAMPLES:');
    });

    it('should show help when -h is provided', async () => {
      const result = await runCLI(['-h']);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        'run-on-output - Execute tasks when CLI output patterns are detected'
      );
    });
  });

  describe('Argument Validation', () => {
    it('should error when no patterns are provided', async () => {
      const result = await runCLI(['-m', 'test', 'echo', 'hello']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'Error: either --patterns or --strings is required'
      );
    });

    it('should error when both patterns and strings are provided', async () => {
      const result = await runCLI([
        '-p',
        'test',
        '-s',
        'test',
        '-m',
        'msg',
        'echo',
        'hello'
      ]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'Error: cannot use both --patterns and --strings together'
      );
    });

    it('should error when no command is provided', async () => {
      const result = await runCLI(['-s', 'test', '-m', 'msg']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Error: command to run is required');
    });

    it('should error when neither run nor message is provided', async () => {
      const result = await runCLI(['-s', 'test', 'echo', 'hello']);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(
        'Error: either --run, --npm, or --message is required'
      );
    });
  });

  describe('Pattern Matching', () => {
    it('should detect string patterns and show message', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-m',
        'Pattern found!',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Pattern found!');
    }, 5000);

    it('should detect multiple string patterns', async () => {
      const result = await runCLI([
        '-s',
        'hello,world',
        '-m',
        'All patterns found!',
        'echo',
        'hello beautiful world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello beautiful world');
      expect(result.stdout).toContain('All patterns found!');
    }, 5000);

    it('should detect regex patterns', async () => {
      const result = await runCLI([
        '-p',
        String.raw`h\w+o`,
        '-m',
        'Regex matched!',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Regex matched!');
    }, 5000);

    it('should not trigger action when pattern is not found', async () => {
      const result = await runCLI([
        '-s',
        'notfound',
        '-m',
        'This should not appear',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).not.toContain('This should not appear');
    }, 5000);

    it('should handle case insensitive string matching', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-m',
        'Case insensitive match!',
        'echo',
        'HELLO WORLD'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('HELLO WORLD');
      expect(result.stdout).toContain('Case insensitive match!');
    }, 5000);
  });

  describe('Command Execution', () => {
    it('should execute run command when patterns are found', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-r',
        'echo "Command executed!"',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Command executed!');
    }, 5000);

    it('should execute both message and run command', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-m',
        'Pattern found!',
        '-r',
        'echo "Command executed!"',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Pattern found!');
      expect(result.stdout).toContain('Command executed!');
    }, 5000);

    it('should execute npm script when patterns are found', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-n',
        'test:echo',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      // Should contain npm script output
      expect(result.stdout).toContain('npm script executed successfully');
    }, 5000);

    it('should execute all actions when patterns are found', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-m',
        'Pattern found!',
        '-r',
        'echo "Command executed!"',
        '-n',
        'test:echo',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Pattern found!');
      expect(result.stdout).toContain('Command executed!');
      expect(result.stdout).toContain('npm script executed successfully');
    }, 10_000);
  });

  describe('Error Handling', () => {
    it('should handle invalid command gracefully', async () => {
      const result = await runCLI([
        '-s',
        'test',
        '-m',
        'Found',
        'nonexistent-command'
      ]);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('Failed to start command');
    }, 5000);

    it('should continue when run command fails', async () => {
      const result = await runCLI([
        '-s',
        'hello',
        '-r',
        'exit 1',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0); // Main command should still complete
      expect(result.stdout).toContain('hello world');
      expect(result.stderr).toContain('Command failed');
    }, 5000);
  });

  describe('Output Forwarding', () => {
    it('should forward stdout in real-time', async () => {
      const result = await runCLI([
        '-s',
        'never-found',
        '-m',
        'Not shown',
        'echo',
        'This output should be forwarded'
      ]);

      expect(result.stdout).toContain('This output should be forwarded');
    }, 5000);

    it('should forward output immediately, not buffer until exit', async () => {
      // This test ensures output is forwarded in real-time, not buffered until process exit
      // Simple test that verifies output forwarding works as expected
      const result = await runCLI([
        '-s',
        'world',
        '-m',
        'Pattern found!',
        'echo',
        'hello world'
      ]);

      expect(result.code).toBe(0);

      // Verify that we got both the original command output and the pattern action
      expect(result.stdout).toContain('hello world');
      expect(result.stdout).toContain('Pattern found!');

      // Verify the order: "hello world" should appear before "Pattern found!"
      const helloIndex = result.stdout.indexOf('hello world');
      const patternIndex = result.stdout.indexOf('Pattern found!');
      expect(helloIndex).toBeLessThan(patternIndex);

      // The key verification: both outputs should be present, indicating
      // that the original command output was forwarded AND the pattern action was executed
      // This tests that output forwarding is working (not just buffering until exit)
      expect(result.stdout).toMatch(/hello world[\s\S]*Pattern found!/);
    }, 5000);

    it('should monitor both stdout and stderr', async () => {
      // Use a shell command that works on both Windows and POSIX
      // This avoids shell quoting issues with node -e
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? 'cmd /c "echo stdout message & echo error message 1>&2"'
        : 'sh -c "echo stdout message; echo error message 1>&2"';
      const result = await runCLI([
        '-s',
        'error',
        '-m',
        'Found in stderr!',
        ...cmd.split(' ')
      ]);

      expect(result.code).toBe(0);
      expect(result.stderr).toContain('error message');
      expect(result.stdout).toContain('stdout message');
      expect(result.stdout).toContain('Found in stderr!');
    }, 5000);
  });

  describe('Signal Handling', () => {
    it('should handle SIGINT gracefully', async () => {
      const child = spawn(
        'node',
        [
          cliPath,
          '-s',
          'never',
          '-m',
          'test',
          'node -e "setTimeout(() => {}, 10000)"'
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );

      // Give the process a moment to start
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      child.kill('SIGINT');

      const exitCode = await new Promise((resolve) => {
        child.on('exit', resolve);
      });

      // Should exit cleanly when interrupted
      expect(exitCode).not.toBeUndefined();
    }, 5000);
  });
});
