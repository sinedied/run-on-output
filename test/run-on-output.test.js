import { spawn } from 'node:child_process';
import process from 'node:process';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  beforeEach(() => {
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
        expect.stringContaining(
          'run-on-output - Execute tasks when CLI output patterns are detected'
        )
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
      expect(result.patterns[1]).toEqual({
        type: 'string',
        value: 'connected'
      });
      expect(result.message).toBe('All good!');
      expect(result.command).toBe('npm');
      expect(result.args).toEqual(['start']);
    });

    it('should parse regex patterns correctly', () => {
      const argv = [
        '-p',
        String.raw`listening on port \d+,ready`,
        '-r',
        'echo "done"',
        'node',
        'app.js'
      ];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0]).toEqual({
        type: 'regex',
        value: expect.any(RegExp)
      });
      expect(result.patterns[0].value.source).toBe(
        String.raw`listening on port \d+`
      );
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
      expect(console.error).toHaveBeenCalledWith(
        'Error: either --patterns or --strings is required'
      );
    });

    it('should not allow both patterns and strings', () => {
      const argv = ['-p', 'test', '-s', 'test', '-m', 'msg', 'echo', 'hello'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith(
        'Error: cannot use both --patterns and --strings together'
      );
    });

    it('should require a command', () => {
      const argv = ['-s', 'test', '-m', 'msg'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith(
        'Error: command to run is required'
      );
    });

    it('should require either run or message', () => {
      const argv = ['-s', 'test', 'echo', 'hello'];
      expect(() => parseArguments(argv)).toThrow('process.exit(1)');
      expect(console.error).toHaveBeenCalledWith(
        'Error: either --run, --npm, or --message is required'
      );
    });

    it('should handle both run and message options', () => {
      const argv = [
        '-s',
        'ready',
        '-m',
        'Done!',
        '-r',
        'echo test',
        'npm',
        'start'
      ];
      const result = parseArguments(argv);

      expect(result.message).toBe('Done!');
      expect(result.runCommand).toBe('echo test');
    });

    it('should handle npm script option', () => {
      const argv = ['-s', 'ready', '-n', 'test', 'npm', 'start'];
      const result = parseArguments(argv);

      expect(result.npmScript).toBe('test');
      expect(result.message).toBeUndefined();
      expect(result.runCommand).toBeUndefined();
    });

    it('should handle all action options together', () => {
      const argv = [
        '-s',
        'ready',
        '-m',
        'Done!',
        '-r',
        'echo test',
        '-n',
        'build',
        'npm',
        'start'
      ];
      const result = parseArguments(argv);

      expect(result.message).toBe('Done!');
      expect(result.runCommand).toBe('echo test');
      expect(result.npmScript).toBe('build');
    });

    it('should handle npm script with short option', () => {
      const argv = ['-s', 'ready', '-n', 'deploy', 'node', 'server.js'];
      const result = parseArguments(argv);

      expect(result.npmScript).toBe('deploy');
    });

    it('should handle npm script with long option', () => {
      const argv = ['-s', 'ready', '--npm', 'deploy', 'node', 'server.js'];
      const result = parseArguments(argv);

      expect(result.npmScript).toBe('deploy');
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
      const argv = [
        '-s',
        'ready',
        '-m',
        'test',
        'npm',
        'run',
        'dev',
        '--port',
        '3000'
      ];
      const result = parseArguments(argv);

      expect(result.command).toBe('npm');
      expect(result.args).toEqual(['run', 'dev', '--port', '3000']);
    });

    it('should handle empty pattern in list', () => {
      const argv = ['-s', 'ready,,done', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(3);
      expect(result.patterns[0].value).toBe('ready');
      expect(result.patterns[1].value).toBe(''); // Empty string pattern between commas
      expect(result.patterns[2].value).toBe('done');
    });

    it('should handle malformed regex patterns gracefully', () => {
      // Even if regex is malformed, the RegExp constructor will create something
      const argv = ['-p', '[unclosed,valid', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].type).toBe('regex');
      expect(result.patterns[1].type).toBe('regex');
      expect(result.patterns[1].value.source).toBe('valid'); // Second pattern should work
    });

    it('should handle very long argument lists', () => {
      const longPatterns = Array.from({ length: 100 })
        .fill('pattern')
        .join(',');
      const argv = ['-s', longPatterns, '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns).toHaveLength(100);
    });

    it('should handle special characters in patterns', () => {
      const argv = ['-s', 'test@#$%,another!@#', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns[0].value).toBe('test@#$%');
      expect(result.patterns[1].value).toBe('another!@#');
    });

    it('should handle unicode characters in patterns', () => {
      const argv = ['-s', '测试,🚀', '-m', 'test', 'echo', 'hello'];
      const result = parseArguments(argv);

      expect(result.patterns[0].value).toBe('测试');
      expect(result.patterns[1].value).toBe('🚀');
    });

    it('should handle commands with complex arguments', () => {
      const argv = [
        '-s',
        'ready',
        '-m',
        'test',
        'docker',
        'run',
        '--rm',
        '-p',
        '8080:80',
        '--name',
        'test-container',
        'nginx'
      ];
      const result = parseArguments(argv);

      expect(result.command).toBe('docker');
      expect(result.args).toEqual([
        'run',
        '--rm',
        '-p',
        '8080:80',
        '--name',
        'test-container',
        'nginx'
      ]);
    });

    it('should handle quoted arguments in commands', () => {
      const argv = ['-s', 'ready', '-m', 'test', 'echo', 'hello world'];
      const result = parseArguments(argv);

      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello world']); // Single argument, not split
    });

    it('should handle invalid parseArgs input gracefully', () => {
      // Test with malformed argv that might cause parseArgs to throw
      const invalidArgv = ['--invalid-flag-format='];

      expect(() => parseArguments(invalidArgv)).toThrow(/process\.exit/);
      expect(console.error).toHaveBeenCalled();
    });

    it('should handle missing required option values', () => {
      const argv = ['-s']; // Missing value for -s

      expect(() => parseArguments(argv)).toThrow();
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

      await expect(executeCommand('echo hello', [])).resolves.toBeUndefined();
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

      await expect(executeCommand('invalid-command', [])).rejects.toThrow(
        'Command failed'
      );
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

      await expect(executeCommand('false', [])).rejects.toThrow(
        'Command failed: exit code 1'
      );
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
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['app.js', '--port', '3000'],
        {
          shell: true,
          stdio: ['ignore', 'inherit', 'inherit']
        }
      );
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

        expect(matcher.checkPatterns('Server listening on port 3000')).toBe(
          true
        );
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

        expect(matcher.checkPatterns('Server listening on port 8080')).toBe(
          false
        );
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

        expect(
          matcher1.checkPatterns('webpack compiled successfully in 1234ms')
        ).toBe(true);
        expect(
          matcher2.checkPatterns('webpack compiled with warnings in 567ms')
        ).toBe(true);
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

        expect(
          matcher.checkPatterns('Server ready and database connected')
        ).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });

      it('should handle empty patterns array', () => {
        const config = { patterns: [] };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('any output')).toBe(true); // No patterns to match
        expect(matcher.isComplete()).toBe(true);
      });

      it('should handle null/undefined output', () => {
        const config = {
          patterns: [{ type: 'string', value: 'test' }]
        };
        const matcher = createPatternMatcher(config);

        expect(() => matcher.checkPatterns(undefined)).toThrow();
      });

      it('should handle very large output strings', () => {
        const config = {
          patterns: [{ type: 'string', value: 'needle' }]
        };
        const matcher = createPatternMatcher(config);

        const largeOutput = 'a'.repeat(10_000) + 'needle' + 'b'.repeat(10_000);
        expect(matcher.checkPatterns(largeOutput)).toBe(true);
      });

      it('should handle overlapping string patterns', () => {
        const config = {
          patterns: [
            { type: 'string', value: 'test' },
            { type: 'string', value: 'testing' }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('testing application')).toBe(true);
        expect(matcher.foundPatterns.has('test')).toBe(true);
        expect(matcher.foundPatterns.has('testing')).toBe(true);
      });

      it('should handle rapid consecutive checks', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        // Simulate rapid output checks
        for (let i = 0; i < 1000; i++) {
          const result = matcher.checkPatterns(`line ${i}`);
          if (i === 500) {
            expect(matcher.checkPatterns('server ready')).toBe(true);
            break;
          }

          expect(result).toBe(false);
        }
      });

      it('should handle multiline output', () => {
        const config = {
          patterns: [
            { type: 'string', value: 'server' },
            { type: 'string', value: 'database' }
          ]
        };
        const matcher = createPatternMatcher(config);

        const multilineOutput = `
          Starting application...
          Server is starting up
          Connecting to database
          Database connection established
          Application ready
        `;

        expect(matcher.checkPatterns(multilineOutput)).toBe(true);
        expect(matcher.foundPatterns.size).toBe(2);
      });

      it('should not continue checking after all patterns found', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('server ready')).toBe(true);

        // These should return false immediately
        expect(matcher.checkPatterns('another ready message')).toBe(false);
        expect(matcher.checkPatterns('ready again')).toBe(false);
      });

      it('should not accumulate unnecessary data', () => {
        const config = {
          patterns: [{ type: 'string', value: 'ready' }]
        };
        const matcher = createPatternMatcher(config);

        // Process many non-matching outputs
        for (let i = 0; i < 1000; i++) {
          matcher.checkPatterns(`non-matching output ${i}`);
        }

        // Should still only have empty foundPatterns
        expect(matcher.foundPatterns.size).toBe(0);
        expect(matcher.isComplete()).toBe(false);
      });
    });

    describe('regex pattern edge cases', () => {
      it('should handle regex with special flags', () => {
        const config = {
          patterns: [{ type: 'regex', value: /test/gi }]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('TEST')).toBe(true);
      });

      it('should handle complex regex patterns', () => {
        const config = {
          patterns: [
            { type: 'regex', value: /(?:listening|started).*port\s*(\d+)/i },
            { type: 'regex', value: /database.*(?:connected|ready)/i }
          ]
        };
        const matcher = createPatternMatcher(config);

        expect(matcher.checkPatterns('Server started on port 3000')).toBe(
          false
        );
        expect(matcher.checkPatterns('Database connection ready')).toBe(true);
        expect(matcher.isComplete()).toBe(true);
      });
    });

    describe('performance and optimization', () => {
      it('should handle many patterns efficiently', () => {
        const patterns = Array.from({ length: 100 }, (_, i) => ({
          type: 'string',
          value: `pattern${i}`
        }));

        const config = { patterns };
        const matcher = createPatternMatcher(config);

        const start = Date.now();

        // Check a large output multiple times
        for (let i = 0; i < 100; i++) {
          matcher.checkPatterns('some output that does not match any pattern');
        }

        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
      });
    });
  });
});
