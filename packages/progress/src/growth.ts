export interface GrowthStage {
  /** 1–4：内容里的 unlockLevel 用的就是这个序号 */
  id: 1 | 2 | 3 | 4;
  name: string;
  /** 英文界面显示名（与 name 一一对应） */
  nameEn: string;
  /** 达到这一阶段所需的累计成长值 */
  atXp: number;
  /** 小屋里的竹竹画多大（视觉上"长大"最直观） */
  scale: number;
}

/**
 * 四个成长阶段（产品方案"熊猫幼崽 → 小熊猫 → 大熊猫 → 解锁小屋/旅行日记"）。
 * 一次任务约 10–16 成长值，所以第四个阶段大约是二十多次陪伴之后 —— 不逼孩子肝。
 */
export const STAGES: readonly GrowthStage[] = [
  { id: 1, name: '熊猫幼崽', nameEn: 'Panda Cub', atXp: 0, scale: 0.82 },
  { id: 2, name: '小熊猫', nameEn: 'Little Panda', atXp: 60, scale: 0.92 },
  { id: 3, name: '大熊猫', nameEn: 'Giant Panda', atXp: 160, scale: 1 },
  { id: 4, name: '竹竹的小屋', nameEn: "Bamboo's Home", atXp: 300, scale: 1.08 },
];

export function stageForXp(xp: number): GrowthStage {
  const safe = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let stage = STAGES[0]!;
  for (const candidate of STAGES) {
    if (safe >= candidate.atXp) stage = candidate;
  }
  return stage;
}

/** 下一阶段；已经到顶返回 null */
export function nextStageForXp(xp: number): GrowthStage | null {
  const current = stageForXp(xp);
  return STAGES.find((stage) => stage.id === current.id + 1) ?? null;
}

/** 距离下一阶段还差多少成长值；到顶返回 0 */
export function xpToNextStage(xp: number): number {
  const next = nextStageForXp(xp);
  if (next === null) return 0;
  return Math.max(0, next.atXp - Math.max(0, xp));
}

/** 等级只用于展示（每个阶段内部还是有小步子的成长感） */
export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 20);
}