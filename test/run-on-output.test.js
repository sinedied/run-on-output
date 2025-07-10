import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  showUsage,
  parseArguments,
  executeCommand,
  createPatternMatcher
} from '../run-on-output.js';

// Mock child_process
vi.mock('node:child_process');

describe('run-on-output', () => {
  let mockSpawn;
  let mockStdout;
  let mockStderr;
  let mockProcess;

  beforeEach(() => {
    mockStdout = vi.fn();
    mockStderr = vi.fn();
    mockProcess = {
      stdout: {
        write: mockStdout
      },
      stderr: {
        write: mockStderr
      },
      exit: vi.fn()
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('showUsage', () => {
    it('should display usage information', () => {
      showUsage();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('run-on-output - Execute tasks when CLI output patterns are detected')
      );
    });

    it('should include all command line options', () => {
      showUsage();
      const output = console.log.mock.calls[0][0];
      expect(output).toContain('--patterns');
      expect(output).toContain('--strings');
      expect(output).toContain('--run');
      expect(output).toContain('--message');
      expect(output).toContain('--help');
    });

    it('should include usage examples', () => {
      showUsage();
      const output = console.log.mock.calls[0][0];
      expect(output).toContain('EXAMPLES:');
      expect(output).toContain('npm start');
      expect(output).toContain('node server.js');
    });
  });

  describe('parseArguments', () => {
    it('should parse string patterns correctly', () => {
      const argv = ['-s', 'ready,connected', '-m', 'All good!', 'npm', 'start'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0]).toEqual({ type: 'string', value: 'ready' });
      expect(result.patterns[1]).toEqual({ type: 'string', value: 'connected' });
      expect(result.message).toBe('All good!');
      expect(result.command).toBe('npm');
      expect(result.args).toEqual(['start']);
    });

    it('should parse regex patterns correctly', () => {
      const argv = ['-p', 'listening on port \\d+,ready', '-r', 'echo "done"', 'node', 'app.js'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0]).toEqual({
        type: 'regex',
        value: expect.any(RegExp)
      });
      expect(result.patterns[0].value.source).toBe('listening on port \\d+');
      expect(result.patterns[0].value.flags).toBe('i');
      expect(result.runCommand).toBe('echo "done"');
      expect(result.command).toBe('node');
      expect(result.args).toEqual(['app.js']);
    });

    it('should handle help flag', () => {
      const argv = ['--help'];
      expect(() => parseArguments(argv)).toThrow('process.exit(0)');
    });

    it('should require either patterns or strings', () => {
      const argv = ['-m', 'test', 'echo', 'hello'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error: either --patterns or --strings is required');
    });

    it('should not allow both patterns and strings', () => {
      const argv = ['-p', 'test', '-s', 'test', '-m', 'msg', 'echo', 'hello'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error: cannot use both --patterns and --strings together');
    });

    it('should require a command', () => {
      const argv = ['-s', 'test', '-m', 'msg'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error: command to run is required');
    });

    it('should require either run or message', () => {
      const argv = ['-s', 'test', 'echo', 'hello'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith('Error: either --run or --message is required');
    });

    it('should handle both run and message options', () => {
      const argv = ['-s', 'ready', '-m', 'Done!', '-r', 'echo test', 'npm', 'start'];
      const result = parseArguments(argv);

      expect(result.message).toBe('Done!');
      expect(result.runCommand).toBe('echo test');
    });

    it('should trim whitespace from patterns', () => {
      const argv = ['-s', ' ready , connected ', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns[0].value).toBe('ready');
      expect(result.patterns[1].value).toBe('connected');
    });

    it('should handle single pattern', () => {
      const argv = ['-s', 'ready', '-m', 'Done', 'npm', 'start'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0]).toEqual({ type: 'string', value: 'ready' });
    });

    it('should convert strings to lowercase for matching', () => {
      const argv = ['-s', 'READY,Connected', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns[0].value).toBe('ready');
      expect(result.patterns[1].value).toBe('connected');
    });

    it('should handle command arguments', () => {
      const argv = ['-s', 'ready', '-m', 'test', 'npm', 'run', 'dev', '--port', '3000'];
      const result = parseArguments(argv);

      expect(result.command).toBe('npm');
      expect(result.args).toEqual(['run', 'dev', '--port', '3000']);
    });
  });

  describe('executeCommand', () => {
    beforeEach(() => {
      mockSpawn = vi.mocked(spawn);
    });

    it('should execute command successfully', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10);
          }
        })
      };
      mockSpawn.mockReturnValue(mockChild);

      await expect(executeCommand('echo hello', [])).resolves.toEqual({ stdout: '', stderr: '' });
      expect(mockSpawn).toHaveBeenCalledWith('echo', ['hello'], {
        shell: true,
        stdio: ['ignore', 'inherit', 'inherit']
      });
    });

    it('should reject on command error', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'error') {
            setTimeout(() => callback(new Error('Command failed')), 10);
          }
        })
      };
      mockSpawn.mockReturnValue(mockChild);

      await expect(executeCommand('invalid-command', [])).rejects.toThrow('Command failed');
    });

    it('should reject on non-zero exit code', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(1), 10);
          }
        })
      };
      mockSpawn.mockReturnValue(mockChild);

      await expect(executeCommand('false', [])).rejects.toThrow('Command failed: exit code 1');
    });

    it('should handle command with arguments', async () => {
      const mockChild = {
        on: vi.fn((event, callback) => {
          if (event === 'exit') {
            setTimeout(() => callback(0), 10);
          }
        })
      };
      mockSpawn.mockReturnValue(mockChild);

      await executeCommand('node app.js', ['--port', '3000']);
      expect(mockSpawn).toHaveBeenCalledWith('node', ['app.js', '--port', '3000'], {
        shell: true,
        stdio: ['ignore', 'inherit', 'inherit']
      });
    });
  });

  describe('createPatternMatcher', () => {
    describe('string patterns', () => {
      it('should match single string pattern', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server is ready')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
        expect(matcher.foundPatterns.has('ready')).toBe(true);
      });

      it('should match multiple string patterns', () => {
        const config = {
          patterns: [
            { type: 'string', value: 'ready' },
            { type: 'string', value: 'connected' }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server is ready')).toBe(false);
        expect(matcher.checkPatterns('Database connected')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
        expect(matcher.foundPatterns.has('ready')).toBe(true);
        expect(matcher.foundPatterns.has('connected')).toBe(true);
      });

      it('should be case insensitive for string matching', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher1 = createPatternMatcher(config);
        const matcher2 = createPatternMatcher(config);

        expect(matcher1.checkPatterns('Server is READY')).toBe(true);
        expect(matcher2.checkPatterns('Ready to serve')).toBe(true);
      });

      it('should not match after completion', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server is ready')).toBe(true);
        expect(matcher.checkPatterns('Another ready message')).toBe(false);
      });
    });

    describe('regex patterns', () => {
      it('should match single regex pattern', () => {
        const config = {
          patterns: [{ type: 'regex', value: /listening on port \d+/i }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server listening on port 3000')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });

      it('should match multiple regex patterns', () => {
        const config = {
          patterns: [
            { type: 'regex', value: /listening on port \d+/i },
            { type: 'regex', value: /database connected/i }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server listening on port 8080')).toBe(false);
        expect(matcher.checkPatterns('MongoDB database connected')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });

      it('should handle complex regex patterns', () => {
        const config = {
          patterns: [{ type: 'regex', value: /webpack compiled.*in \d+ms/i }]
        };
        const matcher1 = createPatternMatcher(config);
        const matcher2 = createPatternMatcher(config);
        const matcher3 = createPatternMatcher(config);

        expect(matcher1.checkPatterns('webpack compiled successfully in 1234ms')).toBe(true);
        expect(matcher2.checkPatterns('webpack compiled with warnings in 567ms')).toBe(true);
        expect(matcher3.checkPatterns('webpack failed to compile')).toBe(false);
      });
    });

    describe('mixed patterns', () => {
      it('should handle both string and regex patterns', () => {
        const config = {
          patterns: [
            { type: 'string', value: 'ready' },
            { type: 'regex', value: /port \d+/i }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server ready')).toBe(false);
        expect(matcher.checkPatterns('Listening on port 3000')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle empty output', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('')).toBe(false);
        expect(matcher.isComplete()).toBe(false);
      });

      it('should handle duplicate pattern matches', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('ready ready ready')).toBe(true);
        expect(matcher.foundPatterns.size).toBe(1);
      });

      it('should handle patterns found in single output', () => {
        const config = {
          patterns: [
            { type: 'string', value: 'ready' },
            { type: 'string', value: 'connected' }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server ready and database connected')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });
    });
  });
});
