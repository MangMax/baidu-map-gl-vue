/**
 * M2-02: ResourceScope
 *
 * 统一管理 Vue 副作用(watch/computed)、SDK 事件、Observer、RAF、timer、
 * Overlay、plugin 和 AbortSignal。所有副作用必须进入 scope,禁止
 * "创建后由组件作者记得清理" 的松散模式。
 *
 * 原则(与方案 §7.1 一致):
 * - `run(factory)` 在受控 effectScope 中执行,管理 Vue watcher/computed。
 * - `add(disposer)` 注册非 Vue 资源的释放函数。
 * - `dispose()` 先停 effectScope,再按注册逆序释放 disposer。
 * - 幂等:重复 dispose 无副作用。
 */
import { effectScope, type EffectScope } from "vue";

export type Disposer = () => void;

export class ResourceScope {
  readonly controller = new AbortController();

  private readonly effects: EffectScope;
  private readonly disposers = new Set<Disposer>();
  private _disposed = false;

  constructor() {
    this.effects = effectScope(true);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** 在被管理的作用域内执行 factory;
   * 允许返回 void(watch/computed 等注册副作用即已纳入 scope)。 */
  run<T>(factory: () => T): T {
    if (this._disposed) {
      throw new Error("ResourceScope has been disposed");
    }
    return this.effects.run(factory) as T;
  }

  /** 注册一个释放函数;已释放时立即执行 */
  add(disposer: Disposer): Disposer {
    if (this._disposed) {
      disposer();
      return disposer;
    }
    this.disposers.add(disposer);
    return () => {
      if (this.disposers.delete(disposer)) {
        disposer();
      }
    };
  }

  /** 在 DOM EventTarget 上注册监听并纳入 scope */
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  /** 注册一个 RAF,放入顺序队列并在 scope 释放时取消 */
  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = requestAnimationFrame(callback);
    this.add(() => cancelAnimationFrame(id));
    return id;
  }

  /** 注册一个定时器 */
  setTimeout(handler: () => void, timeout?: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(handler, timeout);
    this.add(() => clearTimeout(id));
    return id;
  }

  setInterval(handler: () => void, timeout?: number): ReturnType<typeof setInterval> {
    const id = setInterval(handler, timeout);
    this.add(() => clearInterval(id));
    return id;
  }

  /** 注册一个 Observer,scope 释放时断开 */
  observe(observer: { disconnect(): void }): void {
    this.add(() => observer.disconnect());
  }

  /** 注册一个 debounce/throttle 的 cancel */
  addCancellable(cancel: Disposer): void {
    this.add(cancel);
  }

  /** 从父集合摘除指定 disposer（用于 fork child 主动释放后避免父堆积） */
  remove(disposer: Disposer): void {
    this.disposers.delete(disposer);
  }

  /** 从当前 scope fork 出独立 child scope；父 dispose 时联带 dispose child */
  fork(_label?: string): ResourceScope {
    const child = new ResourceScope();
    if (this._disposed) {
      child.dispose();
      return child;
    }
    const disposeChild: Disposer = () => child.dispose();
    this.disposers.add(disposeChild);
    const originalChildDispose = child.dispose.bind(child);
    // 覆盖实例 dispose：主动释放时顺带从父摘除，避免父 disposers 堆积；
    // 父 dispose 联带调用时 remove 已无记录，属于 no-op。
    child.dispose = () => {
      originalChildDispose();
      this.disposers.delete(disposeChild);
    };
    return child;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // 1) 先停 Vue watcher/computed
    this.controller.abort();
    this.effects.stop();

    // 2) 按注册逆序释放非 Vue 资源
    for (const disposer of [...this.disposers].reverse()) {
      try {
        disposer();
      } catch {
        // 由上层 logger 记录,不阻断其他资源释放
      }
    }
    this.disposers.clear();
  }
}
