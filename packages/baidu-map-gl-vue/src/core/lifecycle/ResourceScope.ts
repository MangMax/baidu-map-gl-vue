/**
 * ResourceScope
 *
 * 统一管理 Vue 副作用(watch/computed)、SDK 事件、Observer、RAF、timer、
 * Overlay、plugin 和 AbortSignal。所有副作用必须进入 scope,禁止
 * "创建后由组件作者记得清理" 的松散模式。
 *
 * 原则:
 * - `run(factory)` 在受控 effectScope 中执行,管理 Vue watcher/computed。
 * - `add(disposer)` 注册非 Vue 资源的释放函数。
 * - `dispose()` 先停 effectScope,再按注册逆序释放 disposer。
 * - 幂等:重复 dispose 无副作用。
 */
import { effectScope, type EffectScope } from "vue";
import { logger } from "../logger";

export type Disposer = () => void;

export interface DisposeContext {
  label?: string;
  reason?: unknown;
}

export interface ResourceScopeOptions {
  label?: string;
  parentSignal?: AbortSignal;
  onDisposeError?: (error: unknown, context: DisposeContext) => void;
}

export class ResourceScope {
  readonly controller = new AbortController();
  readonly label?: string;

  private readonly effects: EffectScope;
  private readonly disposers = new Set<Disposer>();
  private readonly options: ResourceScopeOptions;
  private _disposed = false;
  private parentDetach: Disposer | null = null;

  constructor(options: ResourceScopeOptions = {}) {
    this.options = options;
    this.label = options.label;
    this.effects = effectScope(true);
    if (options.parentSignal) {
      if (options.parentSignal.aborted) {
        queueMicrotask(() => {
          if (!this._disposed) this.dispose(options.parentSignal?.reason);
        });
      } else {
        const onParentAbort = () => {
          options.parentSignal?.removeEventListener("abort", onParentAbort);
          if (!this._disposed) this.dispose(options.parentSignal?.reason ?? "parent-signal-aborted");
        };
        options.parentSignal.addEventListener("abort", onParentAbort, { once: true });
        this.parentDetach = () => options.parentSignal?.removeEventListener("abort", onParentAbort);
      }
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get size(): number {
    return this.disposers.size;
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
    let id = 0;
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      try {
        cancelAnimationFrame(id);
      } catch {
        /* ignore */
      }
    };
    const wrapped: FrameRequestCallback = (t) => {
      if (!active) return;
      active = false;
      this.disposers.delete(dispose);
      callback(t);
    };
    // SSR-safe: 非客户端环境降级为 setTimeout
    if (typeof requestAnimationFrame === "function") {
      id = requestAnimationFrame(wrapped);
    } else {
      const tid = setTimeout(() => wrapped(Date.now()), 16);
      const origDispose = dispose;
      void origDispose;
      // 用 timeout 语义覆盖 dispose
      const timeoutDispose = () => {
        if (!active) return;
        active = false;
        clearTimeout(tid);
      };
      this.disposers.add(timeoutDispose);
      return tid as unknown as number;
    }
    this.disposers.add(dispose);
    return id;
  }

  /** Spec 名称:frame —— 一次性 RAF,执行后从 Set 移除 */
  frame(handler: FrameRequestCallback): Disposer {
    let id = 0;
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      try {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
        else clearTimeout(id);
      } catch {
        /* ignore */
      }
    };
    const wrapped: FrameRequestCallback = (t) => {
      if (!active) return;
      active = false;
      this.disposers.delete(dispose);
      handler(t);
    };
    if (typeof requestAnimationFrame === "function") {
      id = requestAnimationFrame(wrapped);
    } else {
      id = setTimeout(() => wrapped(Date.now()), 16) as unknown as number;
    }
    if (this._disposed) {
      dispose();
      return dispose;
    }
    this.disposers.add(dispose);
    return dispose;
  }

  /** 注册一个定时器 */
  setTimeout(handler: () => void, timeout?: number): ReturnType<typeof setTimeout> {
    let active = true;
    const id = setTimeout(() => {
      if (!active) return;
      active = false;
      this.disposers.delete(dispose);
      handler();
    }, timeout);
    const dispose = () => {
      if (!active) return;
      active = false;
      clearTimeout(id);
    };
    this.add(dispose);
    return id;
  }

  /** Spec 名称:timeout —— 一次性 timer,执行后从 Set 移除 */
  timeout(handler: () => void, ms: number): Disposer {
    let active = true;
    const id = setTimeout(() => {
      if (!active) return;
      active = false;
      this.disposers.delete(dispose);
      handler();
    }, ms);
    const dispose = () => {
      if (!active) return;
      active = false;
      clearTimeout(id);
    };
    return this.add(dispose);
  }

  setInterval(handler: () => void, timeout?: number): ReturnType<typeof setInterval> {
    const id = setInterval(handler, timeout);
    this.add(() => clearInterval(id));
    return id;
  }

  /** Spec 名称:interval —— 返回 disposer 供取消 */
  interval(handler: () => void, ms: number): Disposer {
    const id = setInterval(handler, ms);
    return this.add(() => clearInterval(id));
  }

  /** 注册一个 Observer,scope 释放时断开 */
  observe(observer: { disconnect(): void }): Disposer {
    return this.add(() => observer.disconnect());
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
  fork(label?: string): ResourceScope {
    const child = new ResourceScope({
      label,
      parentSignal: this.signal,
      onDisposeError: this.options.onDisposeError,
    });
    if (this._disposed) {
      child.dispose("parent-already-disposed");
      return child;
    }
    const disposeChild: Disposer = () => child.dispose("parent-disposed");
    this.disposers.add(disposeChild);
    const originalChildDispose = child.dispose.bind(child);
    // 覆盖实例 dispose：主动释放时顺带从父摘除，避免父 disposers 堆积；
    // 父 dispose 联带调用时 remove 已无记录，属于 no-op。
    child.dispose = (reason?: unknown) => {
      originalChildDispose(reason);
      this.disposers.delete(disposeChild);
    };
    return child;
  }

  dispose(reason?: unknown): void {
    if (this._disposed) return;
    this._disposed = true;

    // 1) 先停 Vue watcher/computed
    try {
      this.controller.abort(reason);
    } catch {
      try {
        this.controller.abort();
      } catch {
        /* ignore */
      }
    }
    this.effects.stop();
    this.parentDetach?.();
    this.parentDetach = null;

    // 2) 按注册逆序释放非 Vue 资源
    for (const disposer of [...this.disposers].reverse()) {
      try {
        disposer();
      } catch (error) {
        // 销毁错误不可静默丢失:不中断后续 disposer,经 onDisposeError/logger 记录
        try {
          if (this.options.onDisposeError) {
            this.options.onDisposeError(error, { label: this.label, reason });
          } else {
            logger.warn(`ResourceScope dispose failed${this.label ? ` (${this.label})` : ""}`, {
              error: (error as Error)?.message ?? String(error),
            });
          }
        } catch {
          /* 记录回调本身错误不得中断释放 */
        }
      }
    }
    this.disposers.clear();
  }
}
