import { findCjk } from '@bamboo/content/full';
import {
  TASK_IDS,
  TEMPLATE_IDS,
  TIME_SLOTS,
  type Locale,
  type TemplateId,
  type TimeSlot,
} from '@bamboo/content';
import { templateSchemas } from '../schemas';

/**
 * 内容校验的纯逻辑层：只返回 issue 列表，不打印、不退出。
 * cli/check-content.ts 负责把 issues 变成 console 输出与退出码，
 * 单测（cli/content-rules.test.ts）直接喂假数据断言 issue，不需要起 CLI 进程。
 */

/** 只需要「这一关讲不讲得通」的几件事，不必依赖完整的 TaskDetail */
export interface ContentTask {
  readonly id: string;
  readonly template: TemplateId;
  readonly levelScript: unknown;
}

/** 带文案的任务（banned words / 中文残留检查用） */
export interface ContentTaskCopy extends ContentTask {
  readonly title: string;
  readonly habit: string;
  readonly diary: string;
  readonly tip: string;
  readonly intro: string;
  readonly done: string;
  readonly retry: string;
}

/** 内容清单级检查还要看时段（早/中/晚各至少要 2 个任务） */
export interface InventoryTask extends ContentTaskCopy {
  readonly timeSlots: readonly TimeSlot[];
}

/** 供 checkLevelScript 做语义分支的最小形状（schema 已保证字段存在） */
interface ScriptBase {
  readonly [key: string]: unknown;
}

function asRecord(value: unknown): ScriptBase {
  return value as ScriptBase;
}

/**
 * 校验一条任务的关卡脚本：先跑模板 schema（形状），再跑模板专属语义规则。
 * 返回的每条字符串都是一条「人能读、能定位」的问题描述。
 */
export function checkLevelScript(task: ContentTask, locale: Locale): string[] {
  const sources = templateSchemas[task.template];
  if (!sources) {
    return [`${task.id} 的模板没有登记 schema：${task.template}`];
  }
  const parsed = sources.safeParse(task.levelScript);
  if (!parsed.success) {
    return parsed.error.issues.map(
      (issue) =>
        `${task.id}（${locale}）/ ${task.template} 脚本 ` +
        `${issue.path.join('.') || '(根)'}：${issue.message}`,
    );
  }

  // 模板之间的语义约束（schema 只管形状，这里管"这一关讲不讲得通"）
  const issues: string[] = [];
  const script = asRecord(parsed.data);
  const push = (message: string): void => {
    issues.push(`${task.id}（${locale}）/ ${task.template}：${message}`);
  };

  if (task.template === 'feed') {
    const foods = script.foods as { kind: string }[];
    const needs = script.needKinds as string[];
    for (const kind of needs) {
      if (!foods.some((food) => food.kind === kind)) {
        push(`均衡目标里有 ${kind}，但没有任何这种食物`);
      }
    }
  }

  if (task.template === 'tidy') {
    const bins = script.bins as { kind: string }[];
    const items = script.items as { kind: string; id: string }[];
    for (const item of items) {
      if (!bins.some((bin) => bin.kind === item.kind)) {
        push(`玩具 ${item.id}（${item.kind}）没有对应的箱子`);
      }
    }
    if (new Set(bins.map((bin) => bin.kind)).size !== bins.length) {
      push('箱子类别重复');
    }
  }

  if (task.template === 'pick') {
    const rounds = script.rounds as { target: string; options: string[] }[];
    for (const [index, round] of rounds.entries()) {
      if (!round.options.includes(round.target)) {
        push(`第 ${index + 1} 轮的选项里没有正确答案 ${round.target}`);
      }
      if (new Set(round.options).size !== round.options.length) {
        push(`第 ${index + 1} 轮的选项重复`);
      }
    }
  }

  if (task.template === 'learn') {
    // answer 越界会让场景永远判错、整局卡死（schema 已拦一次，这里留语义层的第二道）
    const rounds = script.rounds as { answer: number; options: unknown[] }[];
    for (const [index, round] of rounds.entries()) {
      if (!Number.isInteger(round.answer) || round.answer < 0 || round.answer >= round.options.length) {
        push(`第 ${index + 1} 题的 answer 越界（${round.answer}，选项 ${round.options.length} 个）`);
      }
    }
  }

  if (task.template === 'dress') {
    const items = script.items as { slot: string; id: string }[];
    if (new Set(items.map((item) => item.slot)).size !== items.length) {
      push('同一件衣服被安排了两个位置（slot 重复）');
    }
  }

  if (task.template === 'order') {
    const steps = script.steps as { id: string; label: string }[];
    if (new Set(steps.map((step) => step.id)).size !== steps.length) {
      push('睡前步骤 id 重复');
    }
  }

  if (task.template === 'scrub') {
    const spots = script.spots as { id: string }[];
    if (new Set(spots.map((spot) => spot.id)).size !== spots.length) {
      push('刷洗点的 id 重复');
    }
  }

  return issues;
}

/** 文案禁用词（"失败""惩罚"等）：只查中文字段，英文另有词表 */
export function checkBannedWords(
  task: ContentTaskCopy,
  words: readonly string[],
  label: string,
): string[] {
  const fields = [task.title, task.habit, task.diary, task.tip, task.intro, task.done, task.retry];
  const issues: string[] = [];
  for (const text of fields) {
    for (const word of words) {
      if (text.includes(word)) {
        issues.push(`${task.id} 的${label}文案出现"${word}"：${text}`);
      }
    }
  }
  return issues;
}

/** 英文本地化检查：英文内容里不该再有中文（漏翻） */
export function checkNoCjk(task: ContentTaskCopy): string[] {
  const leaks = findCjk({
    title: task.title,
    habit: task.habit,
    diary: task.diary,
    tip: task.tip,
    intro: task.intro,
    done: task.done,
    retry: task.retry,
    levelScript: task.levelScript,
  });
  return leaks.length > 0 ? [`${task.id} 的英文内容里还有中文：${leaks.join('、')}`] : [];
}

/** 内容清单级检查：数量、缺项、重复 id、标题唯一、英文标题与中文相同（疑似漏翻） */
export function checkInventory(
  tasks: readonly InventoryTask[],
  tasksEn: readonly InventoryTask[],
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();

  for (const task of tasks) {
    if (seen.has(task.id)) issues.push(`任务 id 重复：${task.id}`);
    seen.add(task.id);
  }

  if (tasks.length !== TASK_IDS.length) {
    issues.push(`任务数量不对：期望 ${TASK_IDS.length}，实际 ${tasks.length}`);
  }
  if (tasksEn.length !== tasks.length) {
    issues.push(`英文内容数量不对：期望 ${tasks.length}，实际 ${tasksEn.length}`);
  }
  for (const id of TASK_IDS) {
    if (!seen.has(id)) issues.push(`缺少任务内容：${id}`);
  }
  for (const task of tasks) {
    if (!TEMPLATE_IDS.includes(task.template)) issues.push(`${task.id} 的模板未登记：${task.template}`);
  }

  const zhById = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasksEn) {
    const zh = zhById.get(task.id);
    if (zh !== undefined && zh.title === task.title) {
      issues.push(`${task.id} 的英文标题与中文相同（疑似漏翻）`);
    }
  }

  // 标题唯一（中英各自唯一）
  for (const [label, list] of [['中文', tasks], ['英文', tasksEn]] as const) {
    const titles = new Map<string, string>();
    for (const task of list) {
      const previous = titles.get(task.title);
      if (previous) {
        issues.push(`${label}标题重复："${task.title}" 同时属于 ${previous} 与 ${task.id}`);
      }
      titles.set(task.title, task.id);
    }
  }

  // 时间覆盖：早/中/晚都要有得玩（每条任务至少一个时段，且每个时段至少 2 个任务）
  for (const slot of TIME_SLOTS) {
    const matched = tasks.filter((task) => task.timeSlots.includes(slot));
    if (matched.length < 2) {
      issues.push(`${slot} 时段只有 ${matched.length} 个任务（至少 2 个，保证有得选）`);
    }
  }

  // 模板覆盖：8 个模板都要被真实内容用到
  const usedTemplates = new Set(tasks.map((task) => task.template));
  for (const template of TEMPLATE_IDS) {
    if (!usedTemplates.has(template)) {
      issues.push(`模板 ${template} 没有被任何任务使用（要么用起来，要么从契约里删掉）`);
    }
  }

  return issues;
}