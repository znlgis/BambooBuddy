import type { ZodType } from 'zod';
import type { TemplateId } from '@bamboo/content/ids';
import { scrubLevelSchema } from './scrub.logic';
import { feedLevelSchema } from './feed.logic';
import { dressLevelSchema } from './dress.logic';
import { orderLevelSchema } from './order.logic';
import { tidyLevelSchema } from './tidy.logic';
import { rhythmLevelSchema } from './rhythm.logic';
import { pickLevelSchema } from './pick.logic';
import { learnLevelSchema } from './learn.logic';

/**
 * 模板 id → 关卡脚本 schema。
 * 用 Record<TemplateId, ZodType> 约束：契约里多一个模板而这里没登记，
 * typecheck 当场报；内容里写错模板则 content:check 拦下。
 */
export const templateSchemas = {
  scrub: scrubLevelSchema,
  feed: feedLevelSchema,
  dress: dressLevelSchema,
  order: orderLevelSchema,
  tidy: tidyLevelSchema,
  rhythm: rhythmLevelSchema,
  pick: pickLevelSchema,
  learn: learnLevelSchema,
} satisfies Record<TemplateId, ZodType>;
