import {
  TASK_IDS,
  TEMPLATE_IDS,
  TIME_SLOTS,
  type Locale,
  type TaskDetail,
} from '@bamboo/content';
import { taskDetails, taskDetailsEn } from '@bamboo/content/full';
import {
  checkBannedWords,
  checkInventory,
  checkLevelScript,
  checkNoCjk,
} from './content-rules';

/**
 * 内容校验 CLI：只负责「打印 + 退出码」。
 * 所有判定都在 content-rules.ts 的纯函数里，单测直接调它们。
 */

let errors = 0;

function report(issues: readonly string[]): void {
  for (const message of issues) {
    console.error('  ✗ ' + message);
    errors += 1;
  }
}

function checkTask(task: TaskDetail, locale: Locale): void {
  report(checkLevelScript(task, locale));
  if (locale === 'zh-CN') {
    report(checkBannedWords(task, ['失败', '惩罚', '笨蛋', '输了', '淘汰'], '中文'));
  } else {
    report(checkBannedWords(task, ['fail', 'stupid', 'loser', 'punish'], '英文'));
    report(checkNoCjk(task));
  }
}

console.log('校验 ' + taskDetails.length + ' 个日常任务（zh-CN / en）…\n');

for (const task of taskDetails) {
  console.log('· ' + task.emoji + ' ' + task.title + ' (' + task.id + ')');
  checkTask(task, 'zh-CN');
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

// ---------- 内容清单级：数量 / 缺项 / 重复 / 标题 / 时段 / 模板覆盖 ----------
report(checkInventory(taskDetails, taskDetailsEn));

// ---------- 英文内容：schema + 关卡脚本 + 零残留中文 ----------
console.log('\n英文内容：');
for (const task of taskDetailsEn) {
  checkTask(task, 'en');
  console.log('  · ' + task.title + ' (' + task.id + ')');
}

// ---------- 时间段覆盖：只看数量，方便人工确认 ----------
console.log('\n时间段覆盖：');
for (const slot of TIME_SLOTS) {
  const tasks = taskDetails.filter((task) => task.timeSlots.includes(slot));
  console.log('  · ' + slot + '：' + tasks.length + ' 个（' + tasks.map((task) => task.title).join('、') + '）');
}

// ---------- 模板覆盖：8 个模板都要被真实内容用到 ----------
console.log('\n玩法模板：' + [...new Set(taskDetails.map((task) => task.template))].join('、'));
console.log('\n分组：');
console.log('  · 英文内容：' + taskDetailsEn.length + ' 条（摘要补丁 + 详情补丁）');
console.log(
  '  · 状态收益覆盖：' +
    ['fullness', 'energy', 'clean', 'mood', 'health']
      .filter((key) => taskDetails.some((task) => key in task.stats))
      .join('、'),
);
console.log('  · 任务数量：' + taskDetails.length + ' / ' + TASK_IDS.length + '，模板数量：' + TEMPLATE_IDS.length);

if (errors > 0) {
  console.error('\n内容校验失败：' + errors + ' 个问题');
  process.exit(1);
}
console.log('\n内容校验通过 ✅');
