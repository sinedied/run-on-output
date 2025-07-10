# Contributing

Thank you for contributing! Your contributions help make this project better for everyone.

## Quick Start

```bash
git clone https://github.com/YOUR-USERNAME/run-on-output.git
cd run-on-output
npm install
git checkout -b feature/your-feature
```

## Development

### Available Scripts

- `npm test` - Run Vitest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage
- `npm run lint` - Check code style with XO
- `npm run lint:fix` - Auto-fix style issues

### Code Standards

- Use ES2022 features and Node.js built-in modules only
- Follow XO linting rules (run `npm run lint:fix`)
- Write tests for all changes with Vitest
- Use descriptive names, avoid comments
- Never use `null`, use `undefined` for optional values
- Prefer functions over classes

### Testing

Test manually while developing:
```bash
./run-on-output.js -s "test" -m "Found!" echo "test output"
```

Beforing submitting a PR, ensure all tests pass:
```bash
npm test
```

Also make sure to run the linter and fix any issues:
```bash
npm run lint:fix
```

## Making Changes

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` new features
- `fix:` bug fixes  
- `docs:` documentation
- `test:` adding tests
- `refactor:` code refactoring

### Pull Requests

1. Run `npm run lint` and `npm test`
2. Update help text and README.md for new features
3. Use conventional commit format for PR title
4. Include testing instructions

## Issues & Requests

**Bug Reports**: Include Node.js version, OS, command, expected vs actual behavior, and error output.

**Feature Requests**: Check existing issues first, provide clear use case and rationale.
