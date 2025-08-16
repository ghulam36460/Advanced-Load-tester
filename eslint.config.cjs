// ESLint v9 Flat Config (CommonJS)
/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    files: ["**/*.js"],
    ignores: [
      "node_modules/**",
      "coverage/**",
      "logs/**",
      "reports/**",
      ".trash/**",
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
  // Browser-only file override
  {
    files: ["js/core/browser-tester.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
    },
  },
  // Dashboard browser scripts
  {
    files: ["dashboard/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        location: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
    },
  },
  {
    files: ["test_*.js", "**/*.{test,spec}.js"],
    rules: {
      "no-undef": "off",
    },
  },
];
