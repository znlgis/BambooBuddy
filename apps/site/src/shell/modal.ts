import { nextTick, onScopeDispose, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * 全屏浮层的公共行为：打开时把焦点移进去、Esc 关闭、关闭后把焦点还回去。
 *
 * 三件事缺一件，浮层就只对鼠标用户成立：
 * - 焦点不进去：读屏用户还停在底下的页面上，Tab 一路走到被遮住的按钮；
 * - Esc 关不掉：键盘用户没有"取消"，只能猜哪个按钮是后退；
 * - 焦点不还：关掉后焦点落在 body 上，下一次 Tab 从页面开头重来。
 *
 * 用法：传入浮层根节点的 ref（v-if 打开后才有值）与关闭动作。
 * 只在懒加载视图里用 —— 首屏 60 KB 预算贴线，这里没有一行是给小屋的。
 */
export function useModal(root: Ref<HTMLElement | null>, close: () => void): void {
  /** 打开前焦点所在的元素：关掉后还给它（可能已经被卸载，focus 会自动变成空操作） */
  let restore: HTMLElement | null = null;

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  }

  watch(
    root,
    async (element) => {
      if (element !== null) {
        // 不用 instanceof HTMLElement：node 里没有这个全局，鸭子类型判断足够（且能单测）
        const current = document.activeElement as HTMLElement | null;
        restore = current !== null && typeof current.focus === 'function' ? current : null;
        window.addEventListener('keydown', onKeydown);
        await nextTick();
        // 焦点交给浮层里第一个可操作元素：读屏从这里开始念，键盘从这里开始走
        element.querySelector<HTMLElement>('button, input, [href]')?.focus();
        return;
      }
      window.removeEventListener('keydown', onKeydown);
      restore?.focus();
      restore = null;
    },
    { flush: 'post' },
  );

  onScopeDispose(() => window.removeEventListener('keydown', onKeydown));
}
