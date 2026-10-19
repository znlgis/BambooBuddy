import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 纯逻辑层（progress / *.logic.ts / 内容校验）不碰浏览器，Node 环境即可
    include: [
      'packages/**/src/**/*.test.ts',
      'games/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});
