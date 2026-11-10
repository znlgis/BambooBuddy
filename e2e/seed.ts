import type { Page } from '@playwright/test';
import { SAVE_SCHEMA_VERSION } from '../packages/game-kit/src/contract';

/**
 * e2e 的存档播种工具。
 *
 * 为什么不从界面"先玩几关"凑前置：每条用例只该验证自己那件事（装扮扣费 / 日记朗读 / 家长页时长），
 * 用真实存档写入把前置状态准备好，失败时原因才清楚；而玩法链路已有 brush/tidy/sleep 三条真实指针用例覆盖。
 *
 * 写的是"最小存档"：只给要断言的字段，其余交给 packages/progress 的 migrate/sanitize 逐条兜底 ——
 * 写死一个完整 SaveData 的话，schema 加字段后种子会悄悄失真（老档迁移路径反而测不到）。
 */

/** 本地日键（与 packages/progress/src/day.ts 的 dayKey 同口径）。
 *  必须是函数：一次 pnpm e2e 可能跨零点，模块级常量会让播种的日记录和运行期的"今天"错开。 */
export function todayKey(): string {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export interface SeedSavePatch {
  /** 只写关心的字段，例如 { shoots: 20 } */
  pet?: Record<string, unknown>;
  tasks?: Record<string, unknown>;
  arcade?: Record<string, unknown>;
  /** 日记录（键是 YYYY-MM-DD）；不传时给今天一条空记录 */
  days?: Record<string, Record<string, unknown>>;
}

/** 直接往 IndexedDB 写一份存档，再刷新让外壳按真实读档链路读进去 */
export async function seedSave(page: Page, patch: SeedSavePatch = {}): Promise<void> {
  const today = todayKey();
  const save = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    updatedAt: Date.now(),
    pet: patch.pet ?? {},
    tasks: patch.tasks ?? {},
    arcade: patch.arcade ?? {},
    days: patch.days ?? { [today]: {} },
  };

  // 先落到应用同源页面，才能打开它的 IndexedDB
  await page.goto('/');
  await page.evaluate(async (payload) => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('bamboobuddy', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      const write = (): void => {
        const db = request.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(payload, 'save');
        tx.oncomplete = () => resolve();
        // 写失败也 resolve：后续断言会自然暴露"读不到种子"，不必在这里抛一个没有上下文的错误
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      };
      request.onsuccess = write;
      request.onerror = () => resolve();
    });
  }, save);
  await page.reload();
}
