# Project conventions

## Code formatting

- Format all new and edited code consistently with Prettier and `.editorconfig`.
- Use two-space indentation, single quotes in TypeScript, semicolons, and trailing commas where supported.
- Leave one blank line between function declarations, arrow-function declarations, and object/class method implementations.
- Separate imports from declarations, and separate top-level types, interfaces, classes, and functions with a blank line.
- Use blank lines to separate logical steps within functions: validation, data preparation, persistence, and the returned result. Keep closely related simple declarations together.
- Separate route registrations, hooks, and individual test cases with a blank line.
- Prettier preserves intentional blank lines but does not insert all of these separations. Add them while writing code before running the formatter.
- After changes, run `npm run format` and `npm run format:check`. Keep formatting-only edits free of behavior changes; do not add tests for whitespace changes.
