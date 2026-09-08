/**
 * M2-11: MapRuntime
 *
 * 每个地图实例的运行时容器:
 * - 状态机 idle/loading/ready/error/disposing/disposed
 * - whenReady:可被多个子组件调用,状态可回放
 * - dispose:清理 done 等待者、资源作用域、事件总线、scheduler
 */
import { shallowRef, type ShallowRef } from "vue";
import { BMapError } from "../errors/BMapError";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { createMapEventBus, type MapEventBus, type InternalMapEvents } from "../events/MapEventBus";
import { createFrameScheduler, type FrameScheduler } from "../scheduler/FrameScheduler";
import { createOverlayRegistry, type OverlayRegistry } from "../overlays/OverlayRegistry";
import { createPluginRegistry, type PluginRegistry } from "../plugins/PluginRegistry";
import type { MapReadyContext, MapRuntimeStatus } from "../context/types";

interface Waiter {
  resolve: (ctx: MapReadyContext) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function createAbortError(reason?: unknown): BMapError {
  return new BMapError(
    "BMAP_PROVIDER_ABORTED",
    typeof reason === "string" ? reason : "waitForReady aborted",
    reason !== undefined ? { cause: reason } : undefined,
  );
}

export interface MapRuntimeOptions {
  provider: { load(opts?: unknown, signal?: AbortSignal): Promise<unknown> };
  providerOptions?: Record<string, unknown>;
  /** 创建 map 的工厂:SDK ready 后调用 */
  createMap: (api: unknown, container: HTMLElement, opts?: Record<string, unknown>) => unknown;
  /** 销毁 map 的钩子(如 map.destroy),dispose 时调用 */
  destroyMap?: (map: unknown) => void;
  container: HTMLElement;
  mapOptions?: Record<string, unknown>;
}

export class MapRuntime {
  readonly id = Symbol("map-runtime");
  readonly status: ShallowRef<MapRuntimeStatus> = shallowRef("idle");
  readonly api: ShallowRef<unknown> = shallowRef(null);
  readonly map: ShallowRef<unknown> = shallowRef(null);
  readonly error: ShallowRef<unknown> = shallowRef(null);
  readonly resources = new ResourceScope();
  readonly events: MapEventBus = createMapEventBus();
  readonly scheduler: FrameScheduler = createFrameScheduler();
  readonly overlays: OverlayRegistry = createOverlayRegistry();
  readonly plugins: PluginRegistry;

  private waiters = new Set<Waiter>();
  private options: MapRuntimeOptions;

  /** 可供外部在 setup 后回填的容器引用 */
  container: HTMLElement;

  constructor(options: MapRuntimeOptions) {
    this.options = options;
    this.container = options.container;
    this.plugins = createPluginRegistry(
      // plugin context 动态读取当前 api/map,注册在 runtime 时已就绪
      () => ({ api: this.api.value, map: this.map.value }),
      {
        emit: (type: string, payload: unknown) =>
          this.events.emit(
            type as keyof InternalMapEvents,
            payload as InternalMapEvents[keyof InternalMapEvents],
          ),
      },
      this.resources,
    );
  }

  async mount(): Promise<MapReadyContext> {
    if (this.status.value === "ready") return this.whenReady();
    if (this.status.value === "loading") return this.whenReady();
    if (this.status.value === "disposed" || this.status.value === "disposing") {
      throw new BMapError(
        "BMAP_RUNTIME_DISPOSED",
        "MapRuntime has been disposed and cannot mount again",
      );
    }

    this.status.value = "loading";
    try {
      const api = await this.options.provider.load(
        this.options.providerOptions,
        this.resources.signal,
      );
      if (this.resources.isDisposed) {
        throw new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed during SDK load");
      }
      const map = this.options.createMap(api, this.container, this.options.mapOptions);
      this.api.value = api;
      this.map.value = map;
      this.status.value = "ready";
      const ctx: MapReadyContext = { api, map };
      this.flushWaiters(ctx);
      return ctx;
    } catch (err) {
      const bmapErr =
        err instanceof BMapError
          ? err
          : new BMapError(
              "BMAP_RESOURCE_CREATE_FAILED",
              `MapRuntime failed: ${(err as Error)?.message ?? err}`,
              { cause: err },
            );
      this.status.value = "error";
      this.error.value = bmapErr;
      this.flushWaitersError(bmapErr);
      throw bmapErr;
    }
  }

  whenReady(signal?: AbortSignal): Promise<MapReadyContext> {
    if (this.status.value === "ready") {
      return Promise.resolve({ api: this.api.value, map: this.map.value });
    }
    if (this.status.value === "error") {
      return Promise.reject(this.error.value);
    }
    if (this.status.value === "disposed" || this.status.value === "disposing") {
      return Promise.reject(new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed"));
    }
    // 已 abort 的 signal 立即拒绝，不先加入 Set
    if (signal?.aborted) {
      return Promise.reject(createAbortError((signal as AbortSignal).reason));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      waiter.onAbort = () => {
        this.settleWaiter(waiter, { ok: false, error: createAbortError(signal?.reason) });
      };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  private settleWaiter(
    waiter: Waiter,
    outcome: { ok: true; value: MapReadyContext } | { ok: false; error: unknown },
  ) {
    if (!this.waiters.has(waiter)) return;
    this.waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    if (outcome.ok) waiter.resolve(outcome.value);
    else waiter.reject(outcome.error);
  }

  private flushWaiters(ctx: MapReadyContext) {
    for (const w of [...this.waiters]) {
      this.settleWaiter(w, { ok: true, value: ctx });
    }
  }

  private flushWaitersError(err: unknown) {
    for (const w of [...this.waiters]) {
      this.settleWaiter(w, { ok: false, error: err });
    }
  }

  dispose() {
    if (this.status.value === "disposed" || this.status.value === "disposing") return;
    this.status.value = "disposing";
    // 未等待就绪的等待者统一报 disposed
    this.flushWaitersError(new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed"));
    // 逆序释放:先插件/覆盖物,再 scheduler/bus/resources
    this.plugins.dispose();
    this.overlays.dispose();
    // 销毁 SDK map(如 WebGL context 释放)
    const currentMap = this.map.value;
    if (currentMap && this.options.destroyMap) {
      try {
        this.options.destroyMap(currentMap);
      } catch {
        // 忽略销毁错误
      }
    }
    this.map.value = null;
    this.api.value = null;
    this.scheduler.dispose();
    this.events.clear();
    this.resources.dispose();
    this.status.value = "disposed";
  }
}
