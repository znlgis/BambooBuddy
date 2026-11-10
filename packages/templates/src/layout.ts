/** 逻辑分辨率 750×1334（竖屏）；Phaser 的 Scale.FIT 负责适配真机 */
export const DESIGN = { width: 750, height: 1334 } as const;

export const SCENE_KEYS = {
  scrub: 'scrub',
  feed: 'feed',
  dress: 'dress',
  order: 'order',
  tidy: 'tidy',
  rhythm: 'rhythm',
  pick: 'pick',
  learn: 'learn',
  placeholder: 'placeholder',
} as const;

/** 竹竹在玩法里的默认站位：脚踩地面 */
export const PANDA = {
  x: 375,
  groundY: 1090,
  scale: 1,
} as const;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 三个需要真实指针坐标的模板把布局常量放在这里 ——
 * 这个文件**不 import Phaser**，所以 Playwright 可以安全地直接 import 它来算点击位置
 * （e2e 若 import 场景模块，会连带在 Node 里加载整个 Phaser）。
 * 场景实现必须按这里的最终坐标画，改坐标 = 同时改这里。
 */
export const SCRUB_LAYOUT = {
  /** 内容 JSON 的 spots 0–1 坐标映射到这个矩形（刷牙=牙齿区，洗手=手部区，洗澡=身体区） */
  stage: { x: 250, y: 760, w: 260, h: 220 } satisfies Rect,
  /** 冲水 / 擦干按钮中心（finish 全部完成后才可点） */
  finish: { x: 375, y: 1215 } satisfies Point,
  /** 工具初始位置（拖拽起点） */
  toolHome: { x: 110, y: 1190 } satisfies Point,
} as const;

export const TIDY_LAYOUT = {
  /** 玩具散落区：内容 JSON 的 items 0–1 坐标映射到这里 */
  stage: { x: 60, y: 490, w: 630, h: 430 } satisfies Rect,
  /**
   * 三个箱子的固定中心（e2e 与真实拖拽都按这里算落点）。
   * 第二套关卡有 4 个箱子时不走这里，见 tidyBinPositions：4 箱一排摆不下。
   */
  bins: {
    ball: { x: 150, y: 1170 },
    block: { x: 375, y: 1170 },
    book: { x: 600, y: 1170 },
    /**
     * 仅为类型完整性保留：e2e 用 level.items 的 kind 索引本表，缺键会 typecheck 失败。
     * 4 箱关卡实际不按这个坐标画（原来的 car 箱右缘 760 > 750 会被裁掉），
     * 而是走 tidyBinPositions(4) 的紧凑排；2–3 箱关卡不会出现 car。
     */
    car: { x: 690, y: 1230 },
  } satisfies Record<string, Point>,
} as const;

/**
 * 箱子中心。
 *
 * 2–3 个箱子沿用上面的固定坐标（e2e 与真实操作都按这份坐标算落点，不能动）。
 * 4 个箱子（第二套关卡多了「小车」）一排摆不下三只 190 宽的大箱子 —— 原来的
 * car 箱被挤到 (690, 1230)，右缘 760 超出 750 设计宽被裁掉一截，还会压住书的箱子。
 * 所以 4 箱时改成一排等距、统一 166 宽的紧凑布局，全部落在画面内且互不重叠。
 */
export function tidyBinPositions(kinds: readonly string[]): Point[] {
  const safe = kinds.filter((kind) => typeof kind === 'string' && kind.length > 0);
  if (safe.length <= 3) {
    return safe.map((kind) => {
      const point = (TIDY_LAYOUT.bins as Record<string, Point>)[kind];
      return point ?? TIDY_LAYOUT.bins.ball;
    });
  }
  const width = 166;
  const gap = 22;
  const total = safe.length * width + (safe.length - 1) * gap;
  const startX = (DESIGN.width - total) / 2;
  return Array.from({ length: safe.length }, (_, index) => ({
    x: startX + index * (width + gap) + width / 2,
    y: TIDY_LAYOUT.bins.ball.y,
  }));
}

export const ORDER_LAYOUT = {
  /** 四个睡前道具的中心（id 与内容 steps 的 id 对齐） */
  steps: [
    { id: 'curtain', x: 140, y: 600 },
    { id: 'lamp', x: 610, y: 560 },
    { id: 'blanket', x: 375, y: 1040 },
    { id: 'pat', x: 560, y: 980 },
    { id: 'clock', x: 650, y: 300 },
    { id: 'moon', x: 140, y: 300 },
    { id: 'teddy', x: 620, y: 800 },
  ] satisfies readonly { id: string; x: number; y: number }[],
} as const;

/**
 * 完成卡片的两个出口（设计坐标，按钮 270×108）。
 * 数值与 phaser-kit 的 BaseScene.showCompletionOverlay 保持一致 ——
 * 真实操作类 e2e 需要点「收下」才能离开这一局，而完成卡片是 Phaser 内绘制的，
 * 没有 DOM testid，所以坐标放在这个纯常量模块里给测试用。
 * 两个按钮中心相距 300、自身宽 270：留 30px 间隙，视觉与命中区都不重叠。
 */
export const COMPLETE_LAYOUT = {
  accept: { x: 525, y: 1093 },
  replay: { x: 225, y: 1093 },
} as const;

/**
 * 步骤进度：给「第几步 / 共几步」用的数据形状。
 * index 从 1 开始 = 正在做第几步；全部做完也停在 total，圆点行不会越界。
 */
export interface StepProgress {
  index: number;
  total: number;
}

/**
 * 顶部步骤进度点的几何常量（order / dress / tidy 共用）。
 * 场景按这里的数字画，单测与 e2e 可以安全 import（本文件不 import Phaser）。
 */
export const STEP_DOTS = {
  /** 圆点中心 Y */
  y: 168,
  /** 相邻圆点间距 */
  gap: 64,
  /** 圆点半径 */
  radius: 13,
  /** 描边宽度 */
  outline: 4,
} as const;

/** 一行 total 个圆点居中时的左端 x（没有圆点时就是屏幕中心） */
export function stepDotsLeft(total: number, width: number = DESIGN.width): number {
  if (!Number.isFinite(total) || total <= 0) return width / 2;
  return width / 2 - ((total - 1) * STEP_DOTS.gap) / 2;
}

/**
 * 由「已完成步数 / 总步数」算进度：纯函数，三个模板共用。
 * 全部做完时 index === total；空关卡返回 { index: 1, total: 0 }。
 * 非法输入（NaN / 负数 / 超过总数）逐条兜底，绝不把 NaN 画进界面。
 */
export function stepProgressOf(done: number, total: number): StepProgress {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (safeTotal === 0) return { index: 1, total: 0 };
  const safeDone = Number.isFinite(done) ? Math.min(Math.max(0, Math.floor(done)), safeTotal) : 0;
  return { index: Math.min(safeDone + 1, safeTotal), total: safeTotal };
}

/*
 * 这里原来还有一个 UI 常量（headerH / hintY / buttonH / minTap），全仓库没有任何引用：
 * 场景的按钮尺寸各自写在 addButton(...) 的参数里，可点区域下限由 phaser-kit 的
 * addButton / setContainerHitArea 直接保证。留着一个「改了也不生效」的常量只会误导后来人，
 * 所以删掉；「可点区域 ≥ 96 逻辑像素」这条原则仍在 README 与设计文档里。
 */