/**
 * Fake BMap v4 诊断计数器（M3A3-FAKE-DUAL / issue #24）
 *
 * 一个 Fake 实例的所有可观察计数都在这里，按**两种口径**分开，因为它们的断言方式不同：
 *
 * - `leaks`（泄漏门禁口径）：**当前未释放**的资源数。`0` 是唯一合法值——
 *   「100 次 mount/unmount 之后诊断全归零」断言的就是这一组。它逐项对应一条真实释放路径
 *   （见下表），所以数字非 0 一定指向某个没走完的清理路径，而不是「统计噪音」。
 * - `activity`（活动口径）：累计发生过多少次。它**不**进泄漏门禁（100 次挂载之后
 *   `listenCalls` 当然是 100 而不是 0），但它让「没有重绑」「只重建一次」这类断言有了落点。
 *
 * | leak 计数 | 记账点 | 真实 SDK 的释放入口 |
 * | --- | --- | --- |
 * | `maps` | `Map` 构造 / `Map#destroy` | `map.destroy()` |
 * | `overlays` | `map.addOverlay` / `removeOverlay` | `map.removeOverlay()` |
 * | `infoWindows` | `map.openInfoWindow` / `closeInfoWindow`（同一张图只有一个是「打开」的） | `map.closeInfoWindow()` |
 * | `contextMenus` | `map.addContextMenu` / `removeContextMenu` | `map.removeContextMenu()` |
 * | `controls` | `map.addControl` / `removeControl` | `map.removeControl()` |
 * | `layers` | `map.addLayer` / `removeLayer`（含原生数据图层） | `map.removeLayer()` |
 * | `panoramas` | `Panorama` 构造 / 成功 `destroy()` | `panorama.destroy()` |
 * | `autocompletes` | `Autocomplete` 构造 / 成功 `dispose()` | `autocomplete.dispose()` |
 * | `listeners` | `addEventListener` − `removeEventListener`（外加 `map.destroy()` 时清掉的残留监听器） | `removeEventListener` / `map.destroy()` 的清理 |
 *
 * 两类刻意**不**进泄漏门禁，理由写在对应字段上：
 * - 无销毁入口的服务实例（`Geocoder` / `Convertor` / `Boundary` / `Geolocation` / `LocalCity`）——
 *   官方 4.0 就没有 destroy/dispose，它们随 Client 被 GC 回收；
 * - 定时器与回调队列——「在飞」不等于「未释放」：取消之后 SDK 的迟到回包仍会到达（这是真实
 *   语义，`FakeV4CallbackQueue` 的注释里有一段专门说它），把它们算成泄漏会逼出「为了骗过门禁
 *   而 flush」的假绿。它们的实时值仍可从 `pendingAsync()` / `activity` 读到，由需要的用例显式断言。
 *
 * Fake 特有扩展（不属于官方 SDK 语义、只为本仓库的测试服务）在本文件与各 Fake 类里都标注了
 * 「测试辅助」，避免与官方行为混淆（issue #24 验收标准）。
 */

/** 参与泄漏门禁的资源种类。 */
export type FakeV4ResourceKind =
  | "map"
  | "overlay"
  | "infoWindow"
  | "contextMenu"
  | "control"
  | "layer"
  | "panorama"
  | "autocomplete";

/** 泄漏门禁口径：当前未释放的资源数（全 0 = 无泄漏）。 */
export interface FakeV4LeakCounters {
  maps: number;
  overlays: number;
  infoWindows: number;
  contextMenus: number;
  controls: number;
  layers: number;
  panoramas: number;
  autocompletes: number;
  listeners: number;
}

/** 活动口径：累计计数 + 两个「在飞」实时值。 */
export interface FakeV4ActivityCounters {
  mapsCreated: number;
  overlaysAttached: number;
  overlaysDetached: number;
  infoWindowsOpened: number;
  /** 气泡**销账**的次数：主动关闭，或被新气泡顶掉（后者不是 `close` 事件，见 `FakeMap.openInfoWindow`）。 */
  infoWindowsReleased: number;
  contextMenusAttached: number;
  contextMenusDetached: number;
  controlsAttached: number;
  controlsDetached: number;
  layersAttached: number;
  layersDetached: number;
  panoramasCreated: number;
  panoramasDestroyed: number;
  autocompletesCreated: number;
  autocompletesDisposed: number;
  /** 无释放入口的基础服务实例（构造计数）。 */
  servicesCreated: number;
  listenCalls: number;
  unlistenCalls: number;
  /** `setTimeout` 形式的异步窗口（ViewAnimation 启动延迟、CallbackQueue 的回包延迟）。 */
  timersScheduled: number;
  timersFired: number;
  /** 已派发但尚未执行的回包数（实时值）。 */
  callbacksQueued: number;
  callbacksSettled: number;
  callbacksPending: number;
  timersPending: number;
}

export interface FakeV4DiagnosticsSnapshot {
  leaks: FakeV4LeakCounters;
  activity: FakeV4ActivityCounters;
}

/**
 * 资源种类 → 泄漏计数器字段名。**唯一的事实源**：`snapshot()` 的 `leaks` 与 `assertNoLeaks()`
 * 的检查清单都从它派生。
 *
 * 为什么不是「手抄一个字段名数组」：`Record<FakeV4ResourceKind, …>` 是穷尽的，新增一个
 * `FakeV4ResourceKind` 却忘了登记会**编译失败**；反之若检查清单是手抄的，新字段会被
 * `assertNoLeaks()` 静默漏掉——门禁空转是最难发现的一类失效。
 */
const LEAK_FIELD_BY_KIND: Record<FakeV4ResourceKind, keyof FakeV4LeakCounters> = {
  map: "maps",
  overlay: "overlays",
  infoWindow: "infoWindows",
  contextMenu: "contextMenus",
  control: "controls",
  layer: "layers",
  panorama: "panoramas",
  autocomplete: "autocompletes",
};

export class FakeV4Diagnostics {
  /** `addEventListener` 被调用次数（含重复绑定同一函数）。 */
  listenCalls = 0;
  /** `removeEventListener` 成功移除的次数。 */
  unlistenCalls = 0;
  /** 当前存活的监听器数（全部 target 合计）。 */
  liveListeners = 0;

  private readonly live: Record<FakeV4ResourceKind, number> = {
    map: 0,
    overlay: 0,
    infoWindow: 0,
    contextMenu: 0,
    control: 0,
    layer: 0,
    panorama: 0,
    autocomplete: 0,
  };

  private readonly created: Record<FakeV4ResourceKind, number> = {
    map: 0,
    overlay: 0,
    infoWindow: 0,
    contextMenu: 0,
    control: 0,
    layer: 0,
    panorama: 0,
    autocomplete: 0,
  };

  private readonly released: Record<FakeV4ResourceKind, number> = {
    map: 0,
    overlay: 0,
    infoWindow: 0,
    contextMenu: 0,
    control: 0,
    layer: 0,
    panorama: 0,
    autocomplete: 0,
  };

  /* ------------------------------------------------ 测试辅助：异步窗口（非官方语义） */

  private servicesCreated = 0;
  private timersScheduled = 0;
  private timersFired = 0;
  private callbacksQueued = 0;
  private callbacksSettled = 0;

  /* ------------------------------------------------------------ 记账入口（Fake 内部用） */

  /** 资源进入「已挂载 / 已创建」状态（构造或挂载成功之后调用）。 */
  resourceCreated(kind: FakeV4ResourceKind): void {
    this.created[kind] += 1;
    this.live[kind] += 1;
  }

  /**
   * 资源走完释放路径。
   *
   * 对未挂载的实例是 no-op（真实的 `removeControl` / `removeOverlay` 对没挂过的资源也是 no-op），
   * 且**不会**把计数打成负数——「重复 remove」是契约里明确要求幂等的操作。
   */
  resourceReleased(kind: FakeV4ResourceKind): void {
    if (this.live[kind] <= 0) return;
    this.released[kind] += 1;
    this.live[kind] -= 1;
  }

  /** 无销毁入口的基础服务实例（只进活动口径）。 */
  serviceInstanceCreated(): void {
    this.servicesCreated += 1;
  }

  timerScheduled(): void {
    this.timersScheduled += 1;
  }

  timerFired(): void {
    this.timersFired += 1;
  }

  callbackQueued(): void {
    this.callbacksQueued += 1;
  }

  callbackSettled(): void {
    this.callbacksSettled += 1;
  }

  /* ------------------------------------------------------------------ 读取与门禁 */

  snapshot(): FakeV4DiagnosticsSnapshot {
    // 资源部分从 `LEAK_FIELD_BY_KIND` 派生（新增 kind 时不会漏项），`listeners` 不在资源表里、
    // 单独取事件口径的存活数。断言依据是「映射表穷尽 + 下面这句读全了表」，因此这里的
    // 类型收口是安全的。
    const leaks = {
      listeners: this.liveListeners,
    } as unknown as Record<keyof FakeV4LeakCounters, number>;
    for (const [kind, field] of Object.entries(LEAK_FIELD_BY_KIND) as Array<
      [FakeV4ResourceKind, keyof FakeV4LeakCounters]
    >) {
      leaks[field] = this.live[kind];
    }
    // 活动口径就是「进入 live 状态的次数 / 走完释放路径的次数」：`created` / `released` 两个
    // 累计表本身就是它，`live = created - released` 是唯一的推导关系。
    const activity: FakeV4ActivityCounters = {
      mapsCreated: this.created.map,
      overlaysAttached: this.created.overlay,
      overlaysDetached: this.released.overlay,
      infoWindowsOpened: this.created.infoWindow,
      infoWindowsReleased: this.released.infoWindow,
      contextMenusAttached: this.created.contextMenu,
      contextMenusDetached: this.released.contextMenu,
      controlsAttached: this.created.control,
      controlsDetached: this.released.control,
      layersAttached: this.created.layer,
      layersDetached: this.released.layer,
      panoramasCreated: this.created.panorama,
      panoramasDestroyed: this.released.panorama,
      autocompletesCreated: this.created.autocomplete,
      autocompletesDisposed: this.released.autocomplete,
      servicesCreated: this.servicesCreated,
      listenCalls: this.listenCalls,
      unlistenCalls: this.unlistenCalls,
      timersScheduled: this.timersScheduled,
      timersFired: this.timersFired,
      callbacksQueued: this.callbacksQueued,
      callbacksSettled: this.callbacksSettled,
      callbacksPending: this.callbacksQueued - this.callbacksSettled,
      timersPending: this.timersScheduled - this.timersFired,
    };
    return { leaks, activity };
  }

  /** 仍在飞的两个异步窗口（不进泄漏门禁，按需断言）。 */
  pendingAsync(): { timers: number; callbacks: number } {
    return {
      timers: this.timersScheduled - this.timersFired,
      callbacks: this.callbacksQueued - this.callbacksSettled,
    };
  }

  /**
   * 泄漏门禁：任一 leak 计数非 0 即失败，并逐项列出。
   *
   * 失败信息里带上具体种类与数量，是为了让「哪条释放路径没走完」一眼可见——
   * 只报一句 `expected 0 to be 0` 会让人回头去翻 Fake 源码。
   */
  assertNoLeaks(label = "Fake v4"): FakeV4LeakCounters {
    const { leaks } = this.snapshot();
    // 检查清单直接来自 `snapshot().leaks`：不维护第二份字段名数组，就没有「漏查一项」的可能
    const leaked = Object.entries(leaks).filter(([, count]) => count !== 0);
    if (leaked.length > 0) {
      throw new Error(
        `[${label}] 资源未释放: ${leaked.map(([key, count]) => `${key}=${count}`).join(", ")}`,
      );
    }
    return leaks;
  }

  /** 清零全部计数（活动口径与泄漏口径一起）。 */
  reset(): void {
    this.listenCalls = 0;
    this.unlistenCalls = 0;
    this.liveListeners = 0;
    for (const kind of Object.keys(this.live) as FakeV4ResourceKind[]) {
      this.live[kind] = 0;
      this.created[kind] = 0;
      this.released[kind] = 0;
    }
    this.servicesCreated = 0;
    this.timersScheduled = 0;
    this.timersFired = 0;
    this.callbacksQueued = 0;
    this.callbacksSettled = 0;
  }
}
