import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.scratch/**',
      // 第三方裁剪产物：不是我们的代码，lint 没有意义
      'packages/phaser-kit/vendor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },
  {
    // 外壳只吃摘要：完整内容（关卡脚本 / 语音/ 日记文案）必须走 loadTask() 动态 import，
    // 否则首屏会重新变大（与 CHAGS 的 content / content-full 同一个教训）。
    files: ['apps/site/src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@bamboo/content/full',
              message: '外壳不许直接引入完整内容：用 @bamboo/content 的 loadTask()（动态 import）。',
            },
          ],
        },
      ],
    },
  },
  {
    // 纯逻辑层必须可复现：禁止隐式时钟与随机数，时间与种子都从参数进来。
    files: ['packages/progress/src/**/*.ts', '**/*.logic.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '纯逻辑层禁止 Math.random，请注入种子。' },
        { object: 'Date', property: 'now', message: '纯逻辑层禁止 Date.now，请注入 now。' },
      ],
    },
  },
);
