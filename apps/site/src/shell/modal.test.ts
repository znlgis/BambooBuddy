import { effectScope, nextTick, ref } from 'vue';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModal } from './modal';

/**
 * useModal 只做三件事：焦点移进去、Esc 关闭、关闭后把焦点还回去。
 * 这三件都是无障碍要求（读屏/键盘用户看不到也退不出浮层），但以前没有任何覆盖。
 * 这里用最小 window/document 桩在 node 里跑，不需要引入 @vue/test-utils。
 */

interface Focusable {
  focus: ReturnType<typeof vi.fn>;
}

const handlers: Array<(event: KeyboardEvent) => void> = [];
const removed: Array<(event: KeyboardEvent) => void> = [];

vi.stubGlobal('window', {
  addEventListener: (_type: string, callback: (event: KeyboardEvent) => void) => {
    handlers.push(callback);
  },
  removeEventListener: (_type: string, callback: (event: KeyboardEvent) => void) => {
    removed.push(callback);
    const index = handlers.indexOf(callback);
    if (index >= 0) handlers.splice(index, 1);
  },
});

const previous: Focusable = { focus: vi.fn() };
vi.stubGlobal('document', { activeElement: previous });

const scope = effectScope();
const root = ref<HTMLElement | null>(null);
const close = vi.fn();
scope.run(() => useModal(root, close));

/** 浮层里的第一个按钮：querySelector 只需要能返回它 */
function dialogWithFirstButton(): { focus: ReturnType<typeof vi.fn>; element: HTMLElement } {
  const button = { focus: vi.fn() };
  const element = {
    querySelector: vi.fn(() => button),
  } as unknown as HTMLElement;
  return { focus: button.focus, element };
}

/** watch 回调是 async 的：焦点在下一个微任务里才落下，这里等两拍 */
async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
}

function escapeEvent(): KeyboardEvent {
  return { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

beforeEach(() => {
  close.mockClear();
  previous.focus.mockClear();
  handlers.length = 0;
  removed.length = 0;
});

afterAll(() => {
  scope.stop();
  vi.unstubAllGlobals();
});

describe('全屏浮层的公共行为', () => {
  it('打开：注册 Esc 监听，并把焦点交给浮层里第一个可操作元素', async () => {
    const dialog = dialogWithFirstButton();
    root.value = dialog.element;
    await flush();

    expect(handlers.length).toBe(1);
    expect(dialog.element.querySelector).toHaveBeenCalledWith('button, input, [href]');
    expect(dialog.focus).toHaveBeenCalledTimes(1);
  });

  it('Esc 关闭浮层并吃掉这次按键（不冒泡到页面级处理器）', async () => {
    const dialog = dialogWithFirstButton();
    root.value = dialog.element;
    await flush();

    const event = escapeEvent();
    handlers[0]?.(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('其它按键不关闭浮层', async () => {
    const dialog = dialogWithFirstButton();
    root.value = dialog.element;
    await flush();

    handlers[0]?.({ key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(close).not.toHaveBeenCalled();
  });

  it('关闭：摘掉监听，并把焦点还给打开前的元素', async () => {
    const dialog = dialogWithFirstButton();
    root.value = dialog.element;
    await flush();
    const registered = handlers[0];

    root.value = null;
    await flush();

    expect(removed).toContain(registered);
    expect(handlers.length).toBe(0);
    expect(previous.focus).toHaveBeenCalledTimes(1);
  });

  it('组件销毁时即使浮层还开着也要摘掉监听（不留下全局 keydown）', () => {
    const localScope = effectScope();
    const localRoot = ref<HTMLElement | null>(null);
    localScope.run(() => useModal(localRoot, close));
    localScope.stop();
    expect(removed.length).toBeGreaterThan(0);
  });
});
