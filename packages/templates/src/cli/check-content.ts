import {
  TASK_IDS,
  TEMPLATE_IDS,
  TIME_SLOTS,
  type Locale,
  type TaskDetail,
} from '@bamboo/content';
import { findCjk, taskDetails, taskDetailsEn } from '@bamboo/content/full';
import { templateSchemas } from '../schemas';

let errors = 0;

function fail(message: string): void {
  console.error('  ✗ ' + message);
  errors += 1;
}

function checkLevelScript(task: TaskDetail, locale: Locale): void {
  const schema = templateSchemas[task.template];
  if (!schema) {
    fail(task.id + ' 的模板没有登记 schema：' + task.template);
    return;
  }
  const result = schema.safeParse(task.levelScript);
  if (!result.success) {
    for (const issue of result.error.issues) {
      fail(
        task.id + '（' + locale + '）/ ' + task.template + ' 脚本 ' +
          (issue.path.join('.') || '(根)') + '：' + issue.message,
      );
    }
    return;
  }
  // 模板之间的语义约束（schema 只管形状，这里管"这一关讲不讲得通"）
  const script = result.data as Record<string, unknown>;
  if (task.template === 'feed') {
    const foods = script.foods as { kind: string }[];
    const needs = script.needKinds as string[];
    for (const kind of needs) {
      if (!foods.some((food) => food.kind === kind)) {
        fail(task.id + ' 的均衡目标里有 ' + kind + '，但没有任何这种食物');
      }
    }
  }
  if (task.template === 'tidy') {
    const bins = script.bins as { kind: string; label: string }[];
    const items = script.items as { kind: string; id: string }[];
    for (const item of items) {
      if (!bins.some((bin) => bin.kind === item.kind)) {
        fail(task.id + ' 的玩具 ' + item.id + '（' + item.kind + '）没有对应的箱子');
      }
    }
    if (new Set(bins.map((bin) => bin.kind)).size !== bins.length) {
      fail(task.id + ' 的箱子类别重复');
    }
  }
  if (task.template === 'pick') {
    const rounds = script.rounds as { target: string; options: string[] }[];
    for (const [index, round] of rounds.entries()) {
      if (!round.options.includes(round.target)) {
        fail(task.id + ' 第 ' + (index + 1) + ' 轮的选项里没有正确答案 ' + round.target);
      }
      if (new Set(round.options).size !== round.options.length) {
        fail(task.id + ' 第 ' + (index + 1) + ' 轮的选项重复');
      }
    }
  }
  if (task.template === 'dress') {
    const items = script.items as { slot: string; id: string }[];
    const slots = new Set(items.map((item) => item.slot));
    if (slots.size !== items.length) {
      fail(task.id + ' 同一件衣服被安排了两个位置（slot 重复）');
    }
  }
  if (task.template === 'order') {
    const steps = script.steps as { id: string; label: string }[];
    if (new Set(steps.map((step) => step.id)).size !== steps.length) {
      fail(task.id + ' 的睡前步骤 id 重复');
    }
  }
}

function checkBannedWords(task: TaskDetail, words: string[], label: string): void {
  const fields = [task.title, task.habit, task.diary, task.tip, task.intro, task.done, task.retry];
  for (const text of fields) {
    for (const word of words) {
      if (text.includes(word)) fail(task.id + ' 的' + label + '文案出现"' + word + '"：' + text);
    }
  }
}

console.log('校验 ' + taskDetails.length + ' 个日常任务（zh-CN / en）…\n');

const seen = new Set<string>();
for (const task of taskDetails) {
  console.log('· ' + task.emoji + ' ' + task.title + ' (' + task.id + ')');
  if (seen.has(task.id)) fail('任务 id 重复：' + task.id);
  seen.add(task.id);
  checkLevelScript(task, 'zh-CN');
  checkBannedWords(task, ['失败', '惩罚', '笨蛋', '输了', '淘汰'], '中文');
  console.log(
    '  · ' +
      task.template +
      ' / ' +
      task.timeSlots.map((slot) => ({ morning: '早', noon: '中', evening: '晚' })[slot]).join('') +
      ' / ' +
      task.durationHintSec +
      ' 秒 / ' +
      Object.entries(task.stats)
        .map(([key, value]) => key + '+' + value)
        .join(' ') +
      ' / 竹笋+' +
      task.reward.shoots +
      ' 成长+' +
      task.reward.xp,
  );
  console.log('  · 习惯：' + task.habit + '｜语音：' + task.intro);
}

// ---------- 完整性 ----------
if (taskDetails.length !== TASK_IDS.length) {
  fail('任务数量不对：期望 ' + TASK_IDS.length + '，实际 ' + taskDetails.length);
}
if (taskDetailsEn.length !== taskDetails.length) {
  fail('英文内容数量不对：期望 ' + taskDetails.length + '，实际 ' + taskDetailsEn.length);
}
for (const id of TASK_IDS) {
  if (!seen.has(id)) fail('缺少任务内容：' + id);
}
for (const task of taskDetails) {
  if (!TEMPLATE_IDS.includes(task.template)) fail(task.id + ' 的模板未登记：' + task.template);
}

// ---------- 英文内容：schema + 关卡脚本 + 零残留中文 ----------
console.log('\n英文内容：');
for (const task of taskDetailsEn) {
  const zh = taskDetails.find((item) => item.id === task.id);
  checkLevelScript(task, 'en');
  checkBannedWords(task, ['fail', 'stupid', 'loser', 'punish'], '英文');
  if (zh !== undefined && zh.title === task.title) {
    fail(task.id + ' 的英文标题与中文相同（疑似漏翻）');
  }
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
  if (leaks.length > 0) {
    fail(task.id + ' 的英文内容里还有中文：' + leaks.join('、'));
  } else {
    console.log('  · ' + task.title + ' (' + task.id + ')');
  }
}

// ---------- 时间覆盖：早/中/晚都要有得玩 ----------
console.log('\n时间段覆盖：');
for (const slot of TIME_SLOTS) {
  const tasks = taskDetails.filter((task) => task.timeSlots.includes(slot));
  console.log('  · ' + slot + '：' + tasks.length + ' 个（' + tasks.map((task) => task.title).join('、') + '）');
  if (tasks.length < 2) fail(slot + ' 时段只有 ' + tasks.length + ' 个任务（至少 2 个，保证有得选）');
}

// ---------- 模板覆盖：8 个模板都要被真实内容用到 ----------
const usedTemplates = new Set(taskDetails.map((task) => task.template));
console.log('\n玩法模板：' + [...usedTemplates].join('、'));
for (const template of TEMPLATE_IDS) {
  if (!usedTemplates.has(template)) fail('模板 ' + template + ' 没有被任何任务使用（要么用起来，要么从契约里删掉）');
}

// ---------- 标题唯一（中英各自唯一） ----------
for (const [label, list] of [['中文', taskDetails], ['英文', taskDetailsEn]] as const) {
  const titles = new Map<string, string>();
  for (const task of list) {
    const previous = titles.get(task.title);
    if (previous) fail(label + '标题重复："' + task.title + '" 同时属于 ' + previous + ' 与 ' + task.id);
    titles.set(task.title, task.id);
  }
}

console.log('\n分组：');
console.log('  · 英文内容：' + taskDetailsEn.length + ' 条（摘要补丁 + 详情补丁）');
console.log('  · 状态收益覆盖：' + ['fullness', 'energy', 'clean', 'mood', 'health'].filter((key) => taskDetails.some((task) => key in task.stats)).join('、'));

if (errors > 0) {
  console.error('\n内容校验失败：' + errors + ' 个问题');
  process.exit(1);
}
console.log('\n内容校验通过 ✅');
