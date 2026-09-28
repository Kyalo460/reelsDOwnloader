# Contributing Guide

Thank you for your interest in contributing to ReelDownloader! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/your-org/instagram-reel-downloader/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (OS, browser, Node version)
   - Screenshots if applicable

### Suggesting Features

1. Check existing [Feature Requests](https://github.com/your-org/instagram-reel-downloader/issues?q=label%3Aenhancement)
2. Create a new issue with:
   - Clear description of the feature
   - Use case and motivation
   - Possible implementation approach
   - Any related issues or PRs

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Ensure all tests pass
5. Submit a pull request

## Development Setup

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed setup instructions.

Quick start:

```bash
git clone https://github.com/your-org/instagram-reel-downloader.git
cd instagram-reel-downloader
npm install
cp .env.example .env
# Edit .env with your configuration
npm run db:generate
npm run db:migrate
npm run dev
```

## Coding Standards

### TypeScript

- Use strict mode (enabled in tsconfig.json)
- Prefer `interface` over `type` for object shapes
- Use meaningful names (avoid abbreviations)
- Add JSDoc comments for public APIs
- Avoid `any` - use proper types

### React

- Use functional components with hooks
- Prefer composition over inheritance
- Use TypeScript for props
- Follow React best practices
- Keep components small and focused

### Styling

- Use Tailwind CSS utility classes
- Follow the design system in `tailwind.config.js`
- Use CSS variables for theming
- Mobile-first responsive design

### API Design

- RESTful endpoints
- Consistent error responses
- Proper HTTP status codes
- Request validation with Zod
- Rate limiting on all endpoints

### Database

- Use Prisma migrations for schema changes
- Add indexes for query performance
- Use transactions for multi-step operations
- Soft deletes where appropriate

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Formatting, no code changes
- `refactor`: Code restructuring
- `perf`: Performance improvements
- `test`: Adding tests
- `chore`: Maintenance tasks

Examples:

```
feat(api): add download history endpoint
fix(ui): resolve mobile layout issue
docs: update deployment guide
refactor(media): extract provider interface
```

## Branch Naming

- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation
- `refactor/description` - Code refactoring
- `chore/description` - Maintenance

## Testing Requirements

All PRs must include appropriate tests:

- **Unit tests** for new utilities and services
- **Integration tests** for API endpoints
- **E2E tests** for critical user flows

Run tests before submitting:

```bash
npm run test
npm run test:integration
npm run test:e2e
```

## Code Review Process

1. All PRs require at least one approval
2. CI checks must pass (lint, typecheck, tests)
3. Address review comments
4. Squash commits if requested
5. Merge after approval

## Adding Dependencies

### Production Dependencies

```bash
npm install package-name
```

- Prefer well-maintained packages
- Check bundle size impact
- Verify license compatibility (MIT, Apache-2.0, BSD preferred)
- Update lockfile: `npm install`

### Development Dependencies

```bash
npm install -D package-name
```

Same guidelines apply.

## Security

### Reporting Vulnerabilities

**Do not** create public issues for security vulnerabilities. Instead:

1. Email: security@yourdomain.com
2. Include details and reproduction steps
3. Allow time for fix before disclosure

### Security Practices

- Never commit secrets or credentials
- Use environment variables for configuration
- Validate and sanitize all user input
- Implement rate limiting
- Keep dependencies updated
- Run `npm run security:audit` regularly

## Documentation

Update documentation for:

- New features
- API changes
- Configuration options
- Breaking changes

Documentation files:

- `README.md` - Project overview
- `docs/ARCHITECTURE.md` - System architecture
- `docs/API.md` - API reference
- `docs/SECURITY.md` - Security guidelines
- `docs/DEVELOPMENT.md` - Development setup
- `docs/DEPLOYMENT.md` - Deployment guide

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release tag: `git tag v1.0.0`
4. Push tag: `git push origin v1.0.0`
5. GitHub Actions builds and publishes Docker image
6. Deploy to staging/production

## Getting Help

- [Discord Community](https://discord.gg/your-invite)
- [GitHub Discussions](https://github.com/your-org/instagram-reel-downloader/discussions)
- [Documentation](https://docs.reeldownloader.app)

## Recognition

Contributors are recognized in:

- `CONTRIBUTORS.md` file
- Release notes
- Project website

Thank you for contributing! 🎉
