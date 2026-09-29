module.exports = {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 100,
  bracketSpacing: true,
  arrowParens: 'always',
  // 'auto' keeps each file's existing line endings instead of forcing a rewrite
  // of every line on Windows checkouts (CRLF). The repo is checked out with
  // CRLF, and with 'lf' the prettier/prettier ESLint rule failed the build with
  // "Delete `␍`" on files that had no other formatting issue.
  endOfLine: 'auto',
  plugins: ['prettier-plugin-tailwindcss'],
};
