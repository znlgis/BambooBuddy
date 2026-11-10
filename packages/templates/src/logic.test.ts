import { describe, expect, it } from 'vitest';
import {
  allSpotsClean,
  createScrubState,
  finishTap,
  isScrubComplete,
  scrubAt,
  scrubLevelSchema,
  scrubProgress,
} from './scrub.logic';
import {
  bite,
  createFeedState,
  feedLevelSchema,
  feedProgress,
  totalBites,
} from './feed.logic';
import { createDressState, dressComplete, dressLevelSchema, stepProgress as dressStepProgress, tryDress } from './dress.logic';
import { createOrderState, currentStep, orderComplete, orderLevelSchema, stepProgress as orderStepProgress, tapStep } from './order.logic';
import { createTidyState, stepProgress as tidyStepProgress, tidyComplete, tidyLevelSchema, tidyProgress, tryTidy } from './tidy.logic';
import { STEP_DOTS, stepDotsLeft, stepProgressOf, tidyBinPositions } from './layout';
import {
  createRhythmState,
  cycleMs,
  isInZone,
  nextHitDelay,
  pointerPosition,
  registerTap,
  rhythmComplete,
  rhythmLevelSchema,
  zoneRange,
} from './rhythm.logic';
import { chooseEmotion, comfort, createPickState, pickLevelSchema } from './pick.logic';
import { chooseOption, createLearnState, learnLevelSchema } from './learn.logic';
import { templateSchemas } from './schemas';
import { TEMPLATE_IDS } from '@bamboo/content/ids';

const scrubLevel = scrubLevelSchema.parse({
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
});

const feedLevel = feedLevelSchema.parse({
  room: 'kitchen',
  foods: [
    { id: 'bamboo', kind: 'bamboo', bites: 1, x: 0.1, y: 0.5 },
    { id: 'carrot', kind: 'veg', bites: 2, x: 0.4, y: 0.5 },
    { id: 'apple', kind: 'fruit', bites: 1, x: 0.7, y: 0.5 },
    { id: 'fish', kind: 'protein', bites: 1, x: 0.9, y: 0.5 },
  ],
  needKinds: ['veg', 'fruit'],
});

const dressLevel = dressLevelSchema.parse({
  room: 'closet',
  items: [
    { id: 'hat', slot: 'hat', color: '#7aa05c', x: 0.2, y: 0.5 },
    { id: 'bib', slot: 'bib', color: '#f2c14e', x: 0.5, y: 0.5 },
    { id: 'shoes', slot: 'shoes', color: '#e07a6a', x: 0.8, y: 0.5 },
  ],
});

const orderLevel = orderLevelSchema.parse({
  room: 'bedroom',
  steps: [
    { id: 'curtain', icon: 'curtain', label: '拉窗帘' },
    { id: 'lamp', icon: 'lamp', label: '关灯' },
    { id: 'blanket', icon: 'blanket', label: '盖被子' },
  ],
});

const tidyLevel = tidyLevelSchema.parse({
  room: 'playroom',
  bins: [
    { kind: 'ball', label: '球', color: '#e07a6a' },
    { kind: 'block', label: '积木', color: '#7aa05c' },
    { kind: 'book', label: '书', color: '#e0b45f' },
  ],
  items: [
    { id: 'b1', kind: 'ball', color: '#e07a6a', x: 0.2, y: 0.3 },
    { id: 'k1', kind: 'block', color: '#7aa05c', x: 0.5, y: 0.3 },
    { id: 'r1', kind: 'book', color: '#e0b45f', x: 0.8, y: 0.3 },
    { id: 'b2', kind: 'ball', color: '#e07a6a', x: 0.4, y: 0.6 },
  ],
});

const rhythmLevel = rhythmLevelSchema.parse({ room: 'yard', bpm: 60, jumps: 5, zone: 0.3 });
const pickLevel = pickLevelSchema.parse({
  room: 'bedroom',
  rounds: [
    { target: 'sad', question: '竹竹怎么了？', options: ['happy', 'sad', 'angry'], comfort: 'hug' },
    { target: 'happy', question: '哪一张在笑？', options: ['happy', 'sleepy', 'sad'], comfort: 'highfive' },
  ],
});
const learnLevel = learnLevelSchema.parse({
  room: 'classroom',
  rounds: [
    { kind: 'color', question: '红色？', options: [{ label: '红', color: '#e07a6a' }, { label: '绿', color: '#7aa05c' }], answer: 0 },
    { kind: 'number', question: '数字 3？', options: [{ label: '2' }, { label: '3' }], answer: 1 },
  ],
});

describe('scrub：来回刷掉点点', () => {
  it('只在半径内命中最近的点', () => {
    const state = createScrubState(scrubLevel);
    const miss = scrubAt(state, scrubLevel, 0.35, 0.35);
    expect(miss.hitId).toBeNull();
    const hit = scrubAt(state, scrubLevel, 0.21, 0.21);
    expect(hit.hitId).toBe('a');
    expect(hit.state.cleaned.a).toBe(1);
  });

  it('刷够次数才算干净，刷完的点不再计数', () => {
    let state = createScrubState(scrubLevel);
    state = scrubAt(state, scrubLevel, 0.2, 0.2).state;
    state = scrubAt(state, scrubLevel, 0.2, 0.2).state;
    expect(state.cleaned.a).toBe(2);
    const again = scrubAt(state, scrubLevel, 0.2, 0.2);
    expect(again.cleanedNow).toEqual([]);
    expect(again.state.cleaned.a).toBe(2);
  });

  it('所有点干净之前不进入收尾', () => {
    let state = createScrubState(scrubLevel);
    const first = finishTap(state, scrubLevel);
    expect(first.done).toBe(false);
    state = scrubAt(state, scrubLevel, 0.2, 0.2).state;
    state = scrubAt(state, scrubLevel, 0.2, 0.2).state;
    expect(allSpotsClean(state, scrubLevel)).toBe(false);
    expect(scrubProgress(state, scrubLevel)).toBeGreaterThan(0);
  });

  it('全部刷干净 + 冲够次数 = 完成', () => {
    let state = createScrubState(scrubLevel);
    for (const spot of scrubLevel.spots) {
      for (let i = 0; i < scrubLevel.rubs; i += 1) {
        state = scrubAt(state, scrubLevel, spot.x, spot.y).state;
      }
    }
    expect(allSpotsClean(state, scrubLevel)).toBe(true);
    expect(scrubProgress(state, scrubLevel)).toBe(1);
    state = finishTap(state, scrubLevel).state;
    expect(isScrubComplete(state, scrubLevel)).toBe(false);
    state = finishTap(state, scrubLevel).state;
    expect(isScrubComplete(state, scrubLevel)).toBe(true);
  });

  it('没有收尾动作时刷干净即完成', () => {
    const level = scrubLevelSchema.parse({ ...scrubLevel, finish: undefined });
    let state = createScrubState(level);
    for (const spot of level.spots) {
      for (let i = 0; i < level.rubs; i += 1) state = scrubAt(state, level, spot.x, spot.y).state;
    }
    expect(isScrubComplete(state, level)).toBe(true);
  });

  it('拒绝越界坐标与空点位', () => {
    expect(scrubLevelSchema.safeParse({ ...scrubLevel, spots: [] }).success).toBe(false);
    expect(scrubLevelSchema.safeParse({ ...scrubLevel, spots: [{ id: 'x', x: 2, y: 0, size: 1, kind: 'germ' }] }).success).toBe(false);
  });
});

describe('feed：一口一口吃完', () => {
  it('总口数由每种食物的 bites 累加', () => {
    expect(totalBites(feedLevel)).toBe(5);
  });

  it('喂一口减一口，吃完才消失', () => {
    let state = createFeedState();
    const first = bite(state, feedLevel, 'carrot');
    state = first.state;
    expect(first.left).toBe(1);
    expect(first.finished).toBe(false);
    const second = bite(state, feedLevel, 'carrot');
    expect(second.left).toBe(0);
    expect(second.finished).toBe(true);
  });

  it('全部吃完才完成，均衡目标看类别', () => {
    let state = createFeedState();
    expect(feedProgress(state, feedLevel).complete).toBe(false);
    expect(feedProgress(state, feedLevel).balanced).toBe(false);
    for (const food of feedLevel.foods) {
      for (let i = 0; i < food.bites; i += 1) state = bite(state, feedLevel, food.id).state;
    }
    const progress = feedProgress(state, feedLevel);
    expect(progress.complete).toBe(true);
    expect(progress.balanced).toBe(true);
    expect(progress.kinds).toContain('veg');
    expect(progress.finishedFoods).toHaveLength(4);
  });

  it('未知食物不会破坏状态', () => {
    const state = createFeedState();
    const result = bite(state, feedLevel, 'ghost');
    expect(result.state).toBe(state);
    expect(result.finished).toBe(false);
  });
});

describe('dress：拖到正确的部位', () => {
  it('放对位置才算穿上', () => {
    const state = createDressState();
    expect(tryDress(state, dressLevel, 'hat', 'bib').status).toBe('wrong');
    const right = tryDress(state, dressLevel, 'hat', 'hat');
    expect(right.status).toBe('correct');
    expect(right.state.hat).toBe('hat');
    expect(dressComplete(right.state, dressLevel)).toBe(false);
  });

  it('全部穿好才完成', () => {
    let state = createDressState();
    for (const item of dressLevel.items) state = tryDress(state, dressLevel, item.id, item.slot).state;
    expect(dressComplete(state, dressLevel)).toBe(true);
    expect(tryDress(state, dressLevel, 'hat', 'hat').status).toBe('already');
  });

  it('未知物品不改变状态', () => {
    const state = createDressState();
    expect(tryDress(state, dressLevel, 'nope', 'hat').status).toBe('wrong');
  });
});

describe('order：按顺序哄睡', () => {
  it('先点后面的步骤不算数，也不会清掉进度', () => {
    let state = createOrderState();
    expect(currentStep(state, orderLevel)?.id).toBe('curtain');
    const wrong = tapStep(state, orderLevel, 'lamp');
    expect(wrong.status).toBe('wrong');
    expect(wrong.state.next).toBe(0);
    const right = tapStep(state, orderLevel, 'curtain');
    expect(right.status).toBe('correct');
    state = right.state;
    expect(state.next).toBe(1);
    const second = tapStep(state, orderLevel, 'lamp');
    expect(second.status).toBe('correct');
    expect(tapStep(second.state, orderLevel, 'blanket').status).toBe('complete');
  });

  it('最后一步完成即整局完成', () => {
    let state = createOrderState();
    for (const step of orderLevel.steps) state = tapStep(state, orderLevel, step.id).state;
    expect(orderComplete(state, orderLevel)).toBe(true);
  });

  it('步骤数量有上下限', () => {
    expect(orderLevelSchema.safeParse({ room: 'bedroom', steps: [] }).success).toBe(false);
  });
});

describe('tidy：按类别送玩具回家', () => {
  it('放对箱子才算收纳', () => {
    let state = createTidyState();
    expect(tryTidy(state, tidyLevel, 'b1', 'block').status).toBe('wrong');
    const right = tryTidy(state, tidyLevel, 'b1', 'ball');
    expect(right.status).toBe('correct');
    state = right.state;
    expect(tidyProgress(state, tidyLevel)).toBeCloseTo(0.25);
    expect(tidyComplete(state, tidyLevel)).toBe(false);
  });

  it('全部归位完成', () => {
    let state = createTidyState();
    for (const item of tidyLevel.items) state = tryTidy(state, tidyLevel, item.id, item.kind).state;
    expect(tidyComplete(state, tidyLevel)).toBe(true);
    expect(tidyProgress(state, tidyLevel)).toBe(1);
    expect(tryTidy(state, tidyLevel, 'b1', 'ball').status).toBe('already');
  });

  it('每个玩具类别都必须有箱子（由 content:check 额外守住）', () => {
    expect(tidyLevelSchema.safeParse({ ...tidyLevel, bins: [] }).success).toBe(false);
  });
});

describe('rhythm：看准开合的时机', () => {
  it('指针在 0–1 之间往返，一个来回是两拍', () => {
    expect(cycleMs(rhythmLevel)).toBe(2000);
    const positions = [0, 500, 1000, 1500, 2000].map((ms) => pointerPosition(ms, rhythmLevel));
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...positions)).toBeLessThanOrEqual(1);
    expect(pointerPosition(0, rhythmLevel)).toBe(0);
    expect(pointerPosition(500, rhythmLevel)).toBeCloseTo(0.5);
  });

  it('中心附近是有效窗口', () => {
    const range = zoneRange(rhythmLevel);
    expect(range.from).toBeCloseTo(0.35);
    expect(isInZone(500, rhythmLevel)).toBe(true);
    expect(isInZone(50, rhythmLevel)).toBe(false);
    expect(isInZone(1500, rhythmLevel)).toBe(true);
  });

  it('点中加连击、点空只重来', () => {
    let state = createRhythmState();
    const hit = registerTap(state, 500, rhythmLevel, 1000);
    expect(hit.hit).toBe(true);
    expect(hit.state.hits).toBe(1);
    expect(hit.state.streak).toBe(1);
    state = hit.state;
    const miss = registerTap(state, 50, rhythmLevel, 2000);
    expect(miss.hit).toBe(false);
    expect(miss.state.hits).toBe(1);
    expect(miss.state.streak).toBe(0);
    expect(miss.state.misses).toBe(1);
  });

  it('220ms 内的连点被忽略，不计分也不计错', () => {
    const state = createRhythmState();
    const first = registerTap(state, 500, rhythmLevel, 1000);
    const spam = registerTap(first.state, 500, rhythmLevel, 1100);
    expect(spam.ignored).toBe(true);
    expect(spam.state.hits).toBe(1);
    expect(spam.state.misses).toBe(0);
  });

  it('跳够次数即完成，连击越高音调越高', () => {
    let state = createRhythmState();
    let now = 0;
    while (state.hits < rhythmLevel.jumps) {
      state = registerTap(state, 500, rhythmLevel, now).state;
      now += 300;
    }
    expect(rhythmComplete(state, rhythmLevel)).toBe(true);
    expect(registerTap(state, 500, rhythmLevel, now).tone).toBeGreaterThan(440);
  });

  it('自动通关能算出下一次窗口时间', () => {
    expect(nextHitDelay(500, rhythmLevel)).toBe(0);
    const delay = nextHitDelay(0, rhythmLevel);
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThanOrEqual(cycleMs(rhythmLevel));
  });
});

describe('pick：认情绪 + 安慰', () => {
  it('选错不推进，选对进入安慰阶段', () => {
    let state = createPickState();
    const wrong = chooseEmotion(state, pickLevel, 'happy');
    expect(wrong.status).toBe('wrong');
    expect(wrong.state.round).toBe(0);
    const right = chooseEmotion(state, pickLevel, 'sad');
    expect(right.status).toBe('comfort');
    expect(right.state.phase).toBe('comfort');
    state = right.state;
    const comfortered = comfort(state, pickLevel);
    expect(comfortered.finished).toBe(false);
    state = comfortered.state;
    expect(state.round).toBe(1);
    expect(state.phase).toBe('choose');
  });

  it('最后一轮安慰完即完成', () => {
    let state = createPickState();
    state = chooseEmotion(state, pickLevel, 'sad').state;
    state = comfort(state, pickLevel).state;
    state = chooseEmotion(state, pickLevel, 'happy').state;
    const done = comfort(state, pickLevel);
    expect(done.finished).toBe(true);
    expect(done.state.done).toBe(true);
  });

  it('每轮选项必须包含答案且不重复（在 2 条合法轮次的基线上只让第 2 轮违规）', () => {
    // rounds 必须给足 2 条，否则会先被 schema 的 .min(2) 拒掉，
    // 看上去通过、实际根本没测到「选项重复」这条规则。
    const baseline = pickLevel;
    expect(pickLevelSchema.safeParse(baseline).success).toBe(true);

    const duplicated = pickLevelSchema.safeParse({
      ...baseline,
      rounds: [baseline.rounds[0]!, { ...baseline.rounds[1]!, options: ['happy', 'happy', 'sad'] }],
    });
    expect(duplicated.success).toBe(false);
    if (!duplicated.success) {
      expect(duplicated.error.issues.map((issue) => issue.path.join('.'))).toContain('rounds.1.options');
      expect(duplicated.error.issues.map((issue) => issue.message)).toContain('选项不能重复');
    }

    const missingTarget = pickLevelSchema.safeParse({
      ...baseline,
      rounds: [baseline.rounds[0]!, { ...baseline.rounds[1]!, target: 'angry' }],
    });
    expect(missingTarget.success).toBe(false);
    if (!missingTarget.success) {
      expect(missingTarget.error.issues.map((issue) => issue.message)).toContain('选项里必须包含正确答案 angry');
    }
  });
});

describe('learn：认颜色 / 形状 / 数字', () => {
  it('点错留在原题，点对进入下一题', () => {
    let state = createLearnState();
    expect(chooseOption(state, learnLevel, 1).status).toBe('wrong');
    const right = chooseOption(state, learnLevel, 0);
    expect(right.status).toBe('correct');
    expect(right.state.round).toBe(1);
    state = right.state;
    const done = chooseOption(state, learnLevel, 1);
    expect(done.status).toBe('done');
    expect(done.state.done).toBe(true);
  });

  it('答完最后一题不会越界', () => {
    let state = createLearnState();
    state = chooseOption(state, learnLevel, 0).state;
    state = chooseOption(state, learnLevel, 1).state;
    expect(chooseOption(state, learnLevel, 0).status).toBe('done');
  });

  it('答案下标必须落在选项范围内（在 2 条合法轮次的基线上只让第 2 题越界）', () => {
    // 同理：rounds 只给 1 条会先撞 .min(2)，真正的 answer 越界约束就测不到。
    const baseline = learnLevel;
    expect(learnLevelSchema.safeParse(baseline).success).toBe(true);

    const bad = learnLevelSchema.safeParse({
      ...baseline,
      rounds: [baseline.rounds[0]!, { ...baseline.rounds[1]!, answer: 5 }],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const paths = bad.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('rounds.1.answer');
      expect(bad.error.issues.map((issue) => issue.message).join(' ')).toContain('answer 必须在选项下标范围内');
    }
  });
});

describe('schema 注册表与契约', () => {
  it('8 个模板全部登记了 schema', () => {
    expect(Object.keys(templateSchemas).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('每个 schema 都能拒绝空对象', () => {
    for (const schema of Object.values(templateSchemas)) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });
});

describe('步骤进度：order / dress / tidy 的数据侧', () => {
  it('order：index 从 1 开始，做一步进一格，做完停在 total', () => {
    let state = createOrderState();
    expect(orderStepProgress(state, orderLevel)).toEqual({ index: 1, total: 3 });
    state = tapStep(state, orderLevel, 'curtain').state;
    expect(orderStepProgress(state, orderLevel)).toEqual({ index: 2, total: 3 });
    // 点错不推进进度（与"点错不清进度"同一条规矩）
    const wrong = tapStep(state, orderLevel, 'blanket');
    expect(wrong.status).toBe('wrong');
    expect(orderStepProgress(wrong.state, orderLevel)).toEqual({ index: 2, total: 3 });
    state = tapStep(state, orderLevel, 'lamp').state;
    state = tapStep(state, orderLevel, 'blanket').state;
    expect(orderStepProgress(state, orderLevel)).toEqual({ index: 3, total: 3 });
  });

  it('dress：穿上几件就是第几格', () => {
    let state = createDressState();
    expect(dressStepProgress(state, dressLevel)).toEqual({ index: 1, total: 3 });
    state = tryDress(state, dressLevel, 'hat', 'hat').state;
    expect(dressStepProgress(state, dressLevel)).toEqual({ index: 2, total: 3 });
    // 放错的那一下不计入进度
    const wrong = tryDress(state, dressLevel, 'bib', 'shoes');
    expect(dressStepProgress(wrong.state, dressLevel)).toEqual({ index: 2, total: 3 });
    state = tryDress(state, dressLevel, 'bib', 'bib').state;
    state = tryDress(state, dressLevel, 'shoes', 'shoes').state;
    expect(dressStepProgress(state, dressLevel)).toEqual({ index: 3, total: 3 });
  });

  it('tidy：归位几个玩具就是第几格', () => {
    let state = createTidyState();
    expect(tidyStepProgress(state, tidyLevel)).toEqual({ index: 1, total: 4 });
    state = tryTidy(state, tidyLevel, 'b1', 'ball').state;
    expect(tidyStepProgress(state, tidyLevel)).toEqual({ index: 2, total: 4 });
    const wrong = tryTidy(state, tidyLevel, 'k1', 'ball');
    expect(tidyStepProgress(wrong.state, tidyLevel)).toEqual({ index: 2, total: 4 });
    for (const item of tidyLevel.items.slice(1)) {
      state = tryTidy(state, tidyLevel, item.id, item.kind).state;
    }
    expect(tidyStepProgress(state, tidyLevel)).toEqual({ index: 4, total: 4 });
  });

  it('空关卡与非法输入都不会把 NaN 画进界面', () => {
    expect(stepProgressOf(0, 0)).toEqual({ index: 1, total: 0 });
    expect(stepProgressOf(Number.NaN, 4)).toEqual({ index: 1, total: 4 });
    expect(stepProgressOf(2, Number.NaN)).toEqual({ index: 1, total: 0 });
    expect(stepProgressOf(-3, 4)).toEqual({ index: 1, total: 4 });
    expect(stepProgressOf(99, 4)).toEqual({ index: 4, total: 4 });
    expect(stepProgressOf(2.7, 3.8)).toEqual({ index: 3, total: 3 });
  });

  it('整理箱：2–3 个箱子沿用固定坐标，4 个箱子一排放下且不越界', () => {
    // 2–3 箱：e2e 的真实拖拽按这套坐标算落点，一个像素都不能动
    expect(tidyBinPositions(['ball', 'block', 'book'])).toEqual([
      { x: 150, y: 1170 },
      { x: 375, y: 1170 },
      { x: 600, y: 1170 },
    ]);
    // 内容里 kind 的顺序不一定按布局顺序，按 kind 取坐标
    expect(tidyBinPositions(['book', 'ball'])).toEqual([
      { x: 600, y: 1170 },
      { x: 150, y: 1170 },
    ]);

    // 4 箱（第二套关卡多了「小车」）：统一 166 宽 + 22 间距，全部落在 750 内
    const four = tidyBinPositions(['ball', 'block', 'book', 'car']);
    expect(four).toHaveLength(4);
    for (const point of four) {
      expect(point.x - 83).toBeGreaterThanOrEqual(0);
      expect(point.x + 83).toBeLessThanOrEqual(750);
      expect(point.y).toBe(1170);
    }
    for (let i = 1; i < four.length; i += 1) {
      expect(four[i]!.x - four[i - 1]!.x).toBeCloseTo(188, 6);
    }

    // 空数组 / 未知类别都兜底，不会给场景一个 undefined 坐标
    expect(tidyBinPositions([])).toEqual([]);
    expect(tidyBinPositions(['nope'])).toEqual([{ x: 150, y: 1170 }]);
  });

  it('进度点常量：圆点不重叠、居中算法正确', () => {
    expect(STEP_DOTS.radius).toBeGreaterThan(0);
    expect(STEP_DOTS.gap).toBeGreaterThan(STEP_DOTS.radius * 2);
    expect(STEP_DOTS.y).toBeGreaterThan(0);
    expect(stepDotsLeft(1)).toBe(375);
    expect(stepDotsLeft(3)).toBe(375 - STEP_DOTS.gap);
    expect(stepDotsLeft(0)).toBe(375);
    expect(stepDotsLeft(Number.NaN)).toBe(375);
  });
});

/**
 * 完成之后孩子还会乱点（返回键 / 补一下 / 连点安慰按钮）：
 * 场景层靠 finished/done/locked 守卫拦住，这些守卫依赖「完成态的纯函数不再前进」，
 * 所以把数据契约锁在这里 —— 任何一条判定改成"完成后再算一次"，就会在单测先炸，
 * 而不是等到孩子多拿一颗星、多一个对勾才发现。
 */
describe('完成态之后的重复输入：不推进、不重复计数、不二次完成', () => {
  it('order：做完后再点任意一步仍是 complete，状态不变', () => {
    let state = createOrderState();
    for (const step of orderLevel.steps) state = tapStep(state, orderLevel, step.id).state;
    expect(orderComplete(state, orderLevel)).toBe(true);
    const again = tapStep(state, orderLevel, orderLevel.steps[0]!.id);
    expect(again.status).toBe('complete');
    expect(again.state).toEqual(state);
    expect(orderStepProgress(again.state, orderLevel)).toEqual({ index: 3, total: 3 });
  });

  it('pick：最后一轮安慰完再点，不会二次 finished', () => {
    let state = createPickState();
    state = chooseEmotion(state, pickLevel, 'sad').state;
    state = comfort(state, pickLevel).state;
    state = chooseEmotion(state, pickLevel, 'happy').state;
    const done = comfort(state, pickLevel);
    expect(done.finished).toBe(true);
    expect(done.state.done).toBe(true);
    // 完成卡弹出后，孩子再点一次安慰按钮：不能再来一遍 finished
    const repeat = comfort(done.state, pickLevel);
    expect(repeat.finished).toBe(false);
    expect(repeat.state).toEqual(done.state);
    expect(chooseEmotion(done.state, pickLevel, 'happy').status).toBe('done');
  });

  it('learn：答完最后一题后再点选项仍是 done，不前进', () => {
    let state = createLearnState();
    state = chooseOption(state, learnLevel, 0).state;
    const last = chooseOption(state, learnLevel, 1);
    expect(last.status).toBe('done');
    expect(last.state.done).toBe(true);
    for (const index of [0, 1]) {
      const again = chooseOption(last.state, learnLevel, index);
      expect(again.status).toBe('done');
      expect(again.state).toEqual(last.state);
    }
  });

  it('feed：吃完后同一口再喂不会变负数，也不会重复完成', () => {
    let state = createFeedState();
    for (const food of feedLevel.foods) {
      for (let i = 0; i < food.bites; i += 1) state = bite(state, feedLevel, food.id).state;
    }
    expect(feedProgress(state, feedLevel).complete).toBe(true);
    const again = bite(state, feedLevel, feedLevel.foods[0]!.id);
    expect(again.left).toBe(0);
    expect(Object.values(again.state).every((left) => left >= 0)).toBe(true);
    expect(feedProgress(again.state, feedLevel).complete).toBe(true);
  });

  it('scrub：冲够次数完成后再点，不会继续累加也不二次完成', () => {
    let state = createScrubState(scrubLevel);
    for (const spot of scrubLevel.spots) {
      for (let i = 0; i < scrubLevel.rubs; i += 1) state = scrubAt(state, scrubLevel, spot.x, spot.y).state;
    }
    state = finishTap(state, scrubLevel).state;
    const done = finishTap(state, scrubLevel);
    expect(done.done).toBe(true);
    expect(isScrubComplete(done.state, scrubLevel)).toBe(true);
    const again = finishTap(done.state, scrubLevel);
    expect(again.done).toBe(false);
    expect(again.state).toEqual(done.state);
    expect(again.state.finishTaps).toBe(2);
  });

  it('dress / tidy：全部完成后进度停在 total，不会越界', () => {
    let dressState = createDressState();
    for (const item of dressLevel.items) dressState = tryDress(dressState, dressLevel, item.id, item.slot).state;
    expect(dressStepProgress(dressState, dressLevel)).toEqual({ index: 3, total: 3 });

    let tidyState = createTidyState();
    for (const item of tidyLevel.items) tidyState = tryTidy(tidyState, tidyLevel, item.id, item.kind).state;
    expect(tidyStepProgress(tidyState, tidyLevel)).toEqual({ index: 4, total: 4 });
  });
});