/** 连点保护：两次"真的翻页/推进"之间至少隔这么久（孩子连点两下不会跳过一屏） */
export const TAP_LOCK_MS = 350;

export function isTapArmed(now: number, lastAdvanceAt: number): boolean {
  return now - lastAdvanceAt >= TAP_LOCK_MS;
}
