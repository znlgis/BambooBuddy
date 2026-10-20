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
  /** 箱子中心（按类别固定位置；场景按关卡里出现的箱子渲染） */
  bins: {
    ball: { x: 150, y: 1170 },
    block: { x: 375, y: 1170 },
    book: { x: 600, y: 1170 },
    car: { x: 690, y: 1230 },
  } satisfies Record<string, Point>,
} as const;

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

export const UI = {
  headerH: 140,
  hintY: 260,
  buttonH: 112,
  /** 可点区域下限（88 逻辑像素 ≈ 44 CSS px 的两倍） */
  minTap: 96,
} as const;