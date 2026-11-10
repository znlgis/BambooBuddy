import { describe, expect, it } from 'vitest';
import type { TemplateId } from '@bamboo/content';
import {
  checkBannedWords,
  checkInventory,
  checkLevelScript,
  checkLevelVariants,
  checkNoCjk,
  type ContentTask,
  type InventoryTask,
} from './content-rules';

/**
 * 内容校验纯函数的回归测试：
 * 每个模板一条「合法内容不报错」+ 一条「已知坏内容必须报错」。
 * 这些语义约束是内容侧唯一的安全网（场景运行时不做 zod 校验）。
 */

const scrubGood = {
  room: 'bathroom',
  tool: 'brush',
  rubs: 2,
  spots: [
    { id: 'a', x: 0.2, y: 0.2, size: 1, kind: 'germ' },
    { id: 'b', x: 0.5, y: 0.5, size: 1, kind: 'germ' },
    { id: 'c', x: 0.8, y: 0.8, size: 1, kind: 'germ' },
    { id: 'd', x: 0.8, y: 0.2, size: 1, kind: 'germ' },
  ],
  finish: { kind: 'rinse', taps: 2 },
};

const feedGood = {
  room: 'kitchen',
  foods: [
    { id: 'bamboo', kind: 'bamboo', bites: 1, x: 0.1, y: 0.5 },
    { id: 'carrot', kind: 'veg', bites: 2, x: 0.4, y: 0.5 },
    { id: 'apple', kind: 'fruit', bites: 1, x: 0.7, y: 0.5 },
    { id: 'fish', kind: 'protein', bites: 1, x: 0.9, y: 0.5 },
  ],
  needKinds: ['veg', 'fruit'],
};

const dressGood = {
  room: 'closet',
  items: [
    { id: 'hat', slot: 'hat', color: '#7aa05c', x: 0.2, y: 0.5 },
    { id: 'bib', slot: 'bib', color: '#f2c14e', x: 0.5, y: 0.5 },
    { id: 'shoes', slot: 'shoes', color: '#e07a6a', x: 0.8, y: 0.5 },
  ],
};

const orderGood = {
  room: 'bedroom',
  steps: [
    { id: 'curtain', icon: 'curtain', label: '拉窗帘' },
    { id: 'lamp', icon: 'lamp', label: '关灯' },
    { id: 'blanket', icon: 'blanket', label: '盖被子' },
  ],
};

const tidyGood = {
  room: 'playroom',
  bins: [
    { kind: 'ball', label: '球', color: '#e07a6a' },
    { kind: 'block', label: '积木', color: '#7aa05c' },
  ],
  items: [
    { id: 'b1', kind: 'ball', color: '#e07a6a', x: 0.2, y: 0.3 },
    { id: 'b2', kind: 'ball', color: '#e07a6a', x: 0.4, y: 0.6 },
    { id: 'k1', kind: 'block', color: '#7aa05c', x: 0.5, y: 0.3 },
    { id: 'k2', kind: 'block', color: '#7aa05c', x: 0.8, y: 0.3 },
  ],
};

const rhythmGood = { room: 'yard', bpm: 60, jumps: 5, zone: 0.3 };

const pickGood = {
  room: 'bedroom',
  rounds: [
    { target: 'sad', question: '竹竹怎么了？', options: ['happy', 'sad', 'angry'], comfort: 'hug' },
    { target: 'happy', question: '哪一张在笑？', options: ['happy', 'sleepy', 'sad'], comfort: 'highfive' },
  ],
};

const learnGood = {
  room: 'classroom',
  rounds: [
    {
      kind: 'color',
      question: '哪一个是红色的？',
      options: [{ label: '红', color: '#e07a6a' }, { label: '绿', color: '#7aa05c' }],
      answer: 0,
    },
    {
      kind: 'number',
      question: '数字 3？',
      options: [{ label: '2' }, { label: '3' }],
      answer: 1,
    },
  ],
};

function task(template: TemplateId, levelScript: unknown): ContentTask {
  return { id: 'fixture-' + template, template, levelScript };
}

describe('checkLevelScript：每个模板都有好/坏两条', () => {
  it('scrub：合法内容零 issue', () => {
    expect(checkLevelScript(task('scrub', scrubGood), 'zh-CN')).toEqual([]);
  });

  it('scrub：spots.id 重复必须报错', () => {
    const bad = {
      ...scrubGood,
      spots: scrubGood.spots.map((spot, index) => (index === 1 ? { ...spot, id: 'a' } : spot)),
    };
    const issues = checkLevelScript(task('scrub', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('id 不能重复');
  });

  it('feed：合法内容零 issue', () => {
    expect(checkLevelScript(task('feed', feedGood), 'zh-CN')).toEqual([]);
  });

  it('feed：needKinds 里有类别但没有任何这种食物必须报错', () => {
    const bad = { ...feedGood, needKinds: ['veg', 'grain'] };
    const issues = checkLevelScript(task('feed', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('grain');
  });

  it('dress：合法内容零 issue', () => {
    expect(checkLevelScript(task('dress', dressGood), 'zh-CN')).toEqual([]);
  });

  it('dress：slot 重复必须报错', () => {
    const bad = {
      ...dressGood,
      items: dressGood.items.map((item, index) => (index === 1 ? { ...item, slot: 'hat' } : item)),
    };
    const issues = checkLevelScript(task('dress', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('slot 重复');
  });

  it('order：合法内容零 issue', () => {
    expect(checkLevelScript(task('order', orderGood), 'zh-CN')).toEqual([]);
  });

  it('order：步骤 id 重复必须报错', () => {
    const bad = {
      ...orderGood,
      steps: orderGood.steps.map((step, index) => (index === 1 ? { ...step, id: 'curtain' } : step)),
    };
    const issues = checkLevelScript(task('order', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('id 重复');
  });

  it('tidy：合法内容零 issue', () => {
    expect(checkLevelScript(task('tidy', tidyGood), 'zh-CN')).toEqual([]);
  });

  it('tidy：玩具没有对应箱子必须报错', () => {
    // 保留 2 个箱子（schema 的 min(2) 仍满足），但把 block 的盒子换成 book，
    // 让 items 里的积木无家可归 —— 这样测到的确实是语义规则而不是 schema 的箱数下限。
    const bad = {
      ...tidyGood,
      bins: [tidyGood.bins[0]!, { kind: 'book', label: '书', color: '#e0b45f' }],
    };
    const issues = checkLevelScript(task('tidy', bad), 'zh-CN');
    expect(issues.some((issue) => issue.includes('没有对应的箱子'))).toBe(true);
  });

  it('rhythm：合法内容零 issue', () => {
    expect(checkLevelScript(task('rhythm', rhythmGood), 'zh-CN')).toEqual([]);
  });

  it('rhythm：bpm 越界由 schema 拦下', () => {
    const issues = checkLevelScript(task('rhythm', { ...rhythmGood, bpm: 200 }), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('bpm');
  });

  it('pick：合法内容零 issue', () => {
    expect(checkLevelScript(task('pick', pickGood), 'zh-CN')).toEqual([]);
  });

  it('pick：选项重复必须报错（且不再被 rounds 数量提前撞掉）', () => {
    const bad = {
      ...pickGood,
      rounds: [
        pickGood.rounds[0]!,
        { ...pickGood.rounds[1]!, options: ['happy', 'happy', 'sad'] },
      ],
    };
    const issues = checkLevelScript(task('pick', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('选项不能重复');
  });

  it('pick：正确答案不在选项里必须报错', () => {
    const bad = {
      ...pickGood,
      rounds: [
        pickGood.rounds[0]!,
        { ...pickGood.rounds[1]!, target: 'angry', options: ['happy', 'sleepy', 'sad'] },
      ],
    };
    const issues = checkLevelScript(task('pick', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('必须包含正确答案');
  });

  it('learn：合法内容零 issue', () => {
    expect(checkLevelScript(task('learn', learnGood), 'zh-CN')).toEqual([]);
  });

  it('learn：answer 越界必须报错（这是会让整局卡死的软锁）', () => {
    const bad = {
      ...learnGood,
      rounds: [learnGood.rounds[0]!, { ...learnGood.rounds[1]!, answer: 5 }],
    };
    const issues = checkLevelScript(task('learn', bad), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('rounds.1.answer');
  });

  it('未知模板报「没有登记 schema」', () => {
    const issues = checkLevelScript(
      { id: 'x', template: 'ghost' as TemplateId, levelScript: {} },
      'zh-CN',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('没有登记 schema');
  });

  it('英文 locale 的问题描述带 en 标记', () => {
    const issues = checkLevelScript(task('rhythm', { ...rhythmGood, jumps: 1 }), 'en');
    expect(issues[0]).toContain('（en）');
  });
});

describe('checkLevelVariants：第 2 套及以后同样要过校验', () => {
  // 第二套必须与第一套"明显不同"：这里只要求合法且不重复
  const feedSecond = {
    room: 'kitchen',
    needKinds: ['bamboo', 'veg', 'protein'],
    foods: [
      { id: 'bamboo', kind: 'bamboo', bites: 1, x: 0.16, y: 0.3 },
      { id: 'broccoli', kind: 'veg', bites: 2, x: 0.4, y: 0.34 },
      { id: 'egg', kind: 'protein', bites: 2, x: 0.64, y: 0.3 },
      { id: 'fish', kind: 'protein', bites: 1, x: 0.2, y: 0.7 },
    ],
  };

  function feedTask(variants: unknown[] | undefined): ContentTask {
    return { id: 'feed', template: 'feed', levelScript: feedGood, variants };
  }

  it('两套都合法时零 issue', () => {
    expect(checkLevelVariants(feedTask([feedSecond]), 'zh-CN')).toEqual([]);
  });

  it('只有 1 套（旧格式）会被新标准拦下', () => {
    const issues = checkLevelVariants(feedTask(undefined), 'zh-CN');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('至少 2 套');
  });

  it('第 2 套过不了 schema 时报错并带「第2套」定位', () => {
    const broken = { ...feedSecond, foods: [] };
    const issues = checkLevelVariants(feedTask([broken]), 'zh-CN');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain('第2套');
    expect(issues[0]).toContain('foods');
  });

  it('第 2 套违反语义规则（均衡目标没有对应食物）也要报', () => {
    const unbalanced = { ...feedSecond, needKinds: ['grain'] };
    const issues = checkLevelVariants(feedTask([unbalanced]), 'zh-CN');
    expect(issues.some((issue) => issue.includes('第2套') && issue.includes('grain'))).toBe(true);
  });

  it('两套一模一样必须报错（变体要真的不一样）', () => {
    const issues = checkLevelVariants(feedTask([feedGood]), 'zh-CN');
    expect(issues.some((issue) => issue.includes('完全相同'))).toBe(true);
  });

  it('属性书写顺序不同但内容相同的两套也算重复', () => {
    const reordered = {
      foods: feedGood.foods,
      needKinds: feedGood.needKinds,
      room: feedGood.room,
    };
    const issues = checkLevelVariants(feedTask([reordered]), 'zh-CN');
    expect(issues.some((issue) => issue.includes('完全相同'))).toBe(true);
  });

  it('英文变体里残留中文必须报错', () => {
    const chineseSecond = {
      ...feedSecond,
      foods: feedSecond.foods.map((food) => ({ ...food, id: food.id })),
    };
    const chineseQuestion = {
      room: 'bedroom',
      rounds: [
        { target: 'sad', question: '竹竹怎么了？', options: ['happy', 'sad', 'angry'], comfort: 'hug' },
        { target: 'happy', question: 'Bamboo is smiling — which face?', options: ['happy', 'sleepy', 'sad'], comfort: 'highfive' },
      ],
    };
    // levelScript 用英文合法内容，第 2 套残留中文
    const pickTask: ContentTask = {
      id: 'emotion',
      template: 'pick',
      levelScript: {
        room: 'bedroom',
        rounds: [
          { target: 'sad', question: 'How does Bamboo feel now?', options: ['happy', 'sad', 'angry'], comfort: 'hug' },
          { target: 'happy', question: 'Which face is smiling?', options: ['happy', 'sleepy', 'sad'], comfort: 'highfive' },
        ],
      },
      variants: [chineseQuestion],
    };
    const issues = checkLevelVariants(pickTask, 'en');
    expect(issues.some((issue) => issue.includes('第 2 套') && issue.includes('中文'))).toBe(true);
    // 中文 locale 不会因为"中文"文案报错（只查 schema 与语义）
    expect(checkLevelVariants(pickTask, 'zh-CN')).toEqual([]);
    // 英文变体合法时不报中文问题（feed 第 2 套没有可读文案）
    expect(checkLevelVariants(feedTask([chineseSecond]), 'en')).toEqual([]);
  });
});

describe('checkBannedWords / checkNoCjk', () => {
  const copy = {
    id: 'feed',
    template: 'feed' as TemplateId,
    levelScript: feedGood,
    title: '吃饭',
    habit: '今天自己吃完啦',
    diary: '我自己吃完了饭',
    tip: '慢慢嚼',
    intro: '来吃饭吧',
    done: '真棒',
    retry: '再试一次',
  };

  it('命中禁用词才报错', () => {
    expect(checkBannedWords(copy, ['失败', '惩罚'], '中文')).toEqual([]);
    const issues = checkBannedWords({ ...copy, diary: '失败了也没关系' }, ['失败'], '中文');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('失败');
  });

  it('英文内容里残留中文必须报错', () => {
    expect(checkNoCjk(copy)).toHaveLength(1);
    expect(checkNoCjk({ ...copy, title: 'Meal', habit: 'I ate it', diary: 'I ate', tip: 'Slow', intro: 'Eat', done: 'Great', retry: 'Again', levelScript: rhythmGood })).toEqual([]);
  });
});

describe('checkInventory：清单级约束', () => {
  function inventoryTask(id: string, title: string, timeSlots: readonly ('morning' | 'noon' | 'evening')[], template: TemplateId): InventoryTask {
    return {
      id,
      template,
      levelScript: {},
      title,
      habit: 'h',
      diary: 'd',
      tip: 't',
      intro: 'i',
      done: 'o',
      retry: 'r',
      timeSlots,
    };
  }

  it('完整清单零 issue', () => {
    const ids = ['brush', 'wash', 'feed', 'dress', 'bath', 'sleep', 'tidy', 'sport', 'emotion', 'learn'];
    const templates: TemplateId[] = ['scrub', 'scrub', 'feed', 'dress', 'scrub', 'order', 'tidy', 'rhythm', 'pick', 'learn'];
    const tasks = ids.map((id, index) => inventoryTask(id, '标题' + index, ['morning', 'noon', 'evening'], templates[index]!));
    const tasksEn = ids.map((id, index) => inventoryTask(id, 'Title ' + index, ['morning', 'noon', 'evening'], templates[index]!));
    expect(checkInventory(tasks, tasksEn)).toEqual([]);
  });

  it('重复 id / 缺任务 / 数量不对都会报', () => {
    const ids = ['brush', 'brush'];
    const tasks = ids.map((id, index) => inventoryTask(id, '标题' + index, ['morning'], 'scrub' as TemplateId));
    const issues = checkInventory(tasks, tasks);
    expect(issues.some((issue) => issue.includes('任务 id 重复'))).toBe(true);
    expect(issues.some((issue) => issue.includes('缺少任务内容'))).toBe(true);
    expect(issues.some((issue) => issue.includes('任务数量不对'))).toBe(true);
    expect(issues.some((issue) => issue.includes('时段只有'))).toBe(true);
    expect(issues.some((issue) => issue.includes('模板 '))).toBe(true);
  });

  it('中英关卡套数不一致必须报错', () => {
    const ids = ['brush', 'wash', 'feed', 'dress', 'bath', 'sleep', 'tidy', 'sport', 'emotion', 'learn'];
    const templates: TemplateId[] = ['scrub', 'scrub', 'feed', 'dress', 'scrub', 'order', 'tidy', 'rhythm', 'pick', 'learn'];
    const slots = ['morning', 'noon', 'evening'] as const;
    const withVariants = (id: string, variants: unknown[] | undefined): InventoryTask => ({
      ...inventoryTask(id, 'T-' + id, slots, templates[ids.indexOf(id)]!),
      variants,
    });
    const tasks = ids.map((id) => withVariants(id, [{ second: true }]));
    const tasksEn = ids.map((id, index) => withVariants(id, index === 0 ? [{ second: true }, { third: true }] : [{ second: true }]));
    const issues = checkInventory(tasks, tasksEn);
    expect(issues.some((issue) => issue.includes('中英关卡套数不一致'))).toBe(true);
    expect(issues.filter((issue) => issue.includes('中英关卡套数不一致'))).toHaveLength(1);
  });

  it('标题重复与英文标题未翻都会报', () => {
    const ids = ['brush', 'wash', 'feed', 'dress', 'bath', 'sleep', 'tidy', 'sport', 'emotion', 'learn'];
    const templates: TemplateId[] = ['scrub', 'scrub', 'feed', 'dress', 'scrub', 'order', 'tidy', 'rhythm', 'pick', 'learn'];
    const slots = ['morning', 'noon', 'evening'] as const;
    const tasks = ids.map((id) => inventoryTask(id, '同一个标题', slots, templates[ids.indexOf(id)]!));
    const tasksEn = ids.map((id) => inventoryTask(id, '同一个标题', slots, templates[ids.indexOf(id)]!));
    const issues = checkInventory(tasks, tasksEn);
    expect(issues.some((issue) => issue.includes('中文标题重复'))).toBe(true);
    expect(issues.some((issue) => issue.includes('英文标题与中文相同'))).toBe(true);
  });
});
