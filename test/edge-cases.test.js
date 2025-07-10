import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseArguments, createPatternMatcher } from '../run-on-output.js';

describe('Edge Cases and Error Scenarios', () => {
  let mockConsoleError;

  beforeEach(() => {
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseArguments edge cases', () => {
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
  });

  describe('createPatternMatcher edge cases', () => {
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

      expect(matcher.checkPatterns('Server started on port 3000')).toBe(false);
      expect(matcher.checkPatterns('Database connection ready')).toBe(true);
      expect(matcher.isComplete()).toBe(true);
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
  });

  describe('Performance considerations', () => {
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
  });

  describe('Memory management', () => {
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

  describe('Argument parsing error handling', () => {
    it('should handle invalid parseArgs input gracefully', () => {
      // Test with malformed argv that might cause parseArgs to throw
      const invalidArgv = ['--invalid-flag-format='];

      expect(() => parseArguments(invalidArgv)).toThrow('process.exit(1)');
      expect(mockConsoleError).toHaveBeenCalled();
    });

    it('should handle missing required option values', () => {
      const argv = ['-s']; // Missing value for -s

      expect(() => parseArguments(argv)).toThrow();
    });
  });
});
