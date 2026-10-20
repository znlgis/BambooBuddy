import Phaser from 'phaser';

/**
 * 给 Container 设置整颗按钮的可点区域。
 *
 * 坑（Phaser 3 / 4 行为一致）：`InputManager.pointWithinHitArea` 会先把指针换算成
 * GameObject 的局部坐标，**再加上 displayOrigin**；而 Container 的 displayOrigin
 * 恒等于 (width / 2, height / 2)。所以 hitArea 必须按「左上角为原点」给 (0, 0, w, h)。
 *
 * 若按直觉传居中的 (-w/2, -h/2, w, h)，可点区域会缩到按钮的左上 1/4：
 * 点正中恰好压在命中区的边界上，指针抖一两个像素就时灵时不灵 ——
 * 表现就是「点好几下没反应，偶尔又突然好了」。
 *
 * 等价于 `container.setSize(w, h).setInteractive()`（Phaser 无参时自己用
 * Rectangle(0, 0, width, height)），这里显式写出来并留下注释，避免下一个人再踩。
 */
export function setContainerHitArea(
  container: Phaser.GameObjects.Container,
  width: number,
  height: number,
): void {
  container.setSize(width, height);
  container.setInteractive(
    new Phaser.Geom.Rectangle(0, 0, width, height),
    Phaser.Geom.Rectangle.Contains,
  );
}
