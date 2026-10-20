import Phaser from 'phaser';
import { THEME } from './theme';

export interface CreateGameOptions {
  scenes: Phaser.Types.Scenes.SceneType[];
}

/**
 * 宿主只需要「容器 + 设计尺寸」两件事。日常玩法（GameContext）与隐藏小游戏（ArcadeContext）
 * 都满足这个形状 —— 引擎启动代码只写一份。
 */
export interface PhaserGameHost {
  container: HTMLElement;
  manifest: { designSize: { width: number; height: number } };
}

/**
 * 每个游戏包自己创建 Phaser 实例；unmount 时必须 destroy，
 * 避免路由切换或 HMR 之后残留 canvas 与 requestAnimationFrame 循环。
 */
export function createPhaserGame(ctx: PhaserGameHost, opts: CreateGameOptions): Phaser.Game {
  const { width, height } = ctx.manifest.designSize;
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: ctx.container,
    width,
    height,
    backgroundColor: THEME.ink,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    audio: { noAudio: true },
    scene: opts.scenes,
  });
}
