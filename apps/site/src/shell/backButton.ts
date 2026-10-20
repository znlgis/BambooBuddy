import { nativeApp } from '@bamboo/platform';
import { navigate } from '../router';
import type { Route } from '../router';
import type { Ref } from 'vue';

/**
 * 原生壳（Capacitor / Tauri）返回键桥的最小接口 —— 只用到这两个方法。
 *
 * 抽成接口是为了**能单测**：浏览器里没有原生壳，这条路径以前 0 覆盖，
 * 直到真机上误按返回键把游戏关掉才会发现。
 */
export interface BackBridge {
  addListener(event: 'backButton', callback: () => void): void;
  exitApp(): Promise<void>;
}

/** 跳转实现：默认是 hash 路由；单测注入假实现，不必在 node 里伪造 window */
export type NavigateTo = (path: string) => void;

/**
 * 安卓实体返回键的正确行为：
 * 在游戏 / 任务 / 装扮 / 日记 / 家长页 → 回到小屋；已经在小屋 → 才退出应用。
 * 不处理的话，孩子在游戏里误按返回键会直接把应用关掉。
 */
export function installBackButtonHandler(
  route: Ref<Route>,
  bridge: BackBridge | null = nativeApp(),
  goHome: NavigateTo = navigate,
): void {
  // 浏览器（含 PWA）里没有原生桥：直接返回，不报错
  if (bridge === null) return;
  bridge.addListener('backButton', () => {
    const name = route.value.name;
    // 隐藏小游戏：先回游戏厅（不直接回小屋，孩子可能还想换一个玩）
    if (name === 'arcadePlay') {
      goHome('/arcade');
      return;
    }
    if (name !== 'home') {
      goHome('/');
      return;
    }
    void bridge.exitApp();
  });
}
