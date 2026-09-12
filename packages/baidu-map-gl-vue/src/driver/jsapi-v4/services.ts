/**
 * v4 ServiceDriver（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 两件事写在同一处，因为它们必须一起成立：
 *
 * 1. **创建面**（`ServiceDriver`）：6 项基础服务 + `ViewAnimation` 经 `namespaceCtor` 创建，
 *    实例一律 `registry.adopt` 成句柄（跨 Client 混用抛 `BMAP_HANDLE_FOREIGN`）；
 * 2. **归一化调用面**（`ServiceInvocationDriver`）：SDK 的 callback 风格收敛成
 *    `ServiceCall<ServiceResult<T>>`（`../normalize/serviceCall`），业务不再需要自己写
 *    「超时 / 空结果 / 迟到回调」三件套。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - `Geocoder#getPoint/getLocation`、`Convertor#translate`、`Boundary#get`、`LocalCity#get`、
 *   `Geolocation#getCurrentPosition` + `getStatus`、`Autocomplete#search` /
 *   `AutocompleteOptions.onSearchComplete` 是各自唯一的调用入口；
 * - 前四者失败时**只回 `null`**，服务端错误码只在 JSONP 回调注册表里——因此「空结果」与
 *   「失败」的区分靠 `../normalize/jsonpProbe` 的嗅探（与 webgl-v1 共用同一实现）；
 * - `Geolocation` 是唯一自带状态码的服务（`getStatus()` → `BMAP_STATUS_*`），因此它的
 *   `sdkStatus` 恒有值；
 * - `Autocomplete` 是**事件式**服务：`search()` 只负责发起请求，结果经构造选项的
 *   `onSearchComplete` 回来。归一化调用因此由 Driver 在创建时挂一个**内部分发器**：
 *   既结算 pending 的 `suggest()`，也把同一个回调转给调用方传入的 `onSearchComplete`
 *   （不吞掉业务本来就有的监听）；
 * - `TrackAnimation` 属 `BMapGLLib` 插件、不在 4.0 的运行时入口里（Catalog
 *   `service.track-animation` 为 `unsupported`，迁移结论属 M8 #43），因此**显式失败**
 *   而不是静默给一个不能用的实例——4.0 的对应能力是原生图层 `TrackLine`。
 */
import { BMapError } from "../../core/errors/BMapError";
import { captureJsonpServiceError, type JsonpErrorCapture } from "../normalize/jsonpProbe";
import { createServiceCall } from "../normalize/serviceCall";
import { toPlainPoint } from "../normalize/results";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import type { GeometryDriver, Point } from "../types/geometry";
import type { MapHandle, SdkHandle, ServiceHandle } from "../types/handles";
import type {
  AutocompleteOptions,
  BoundaryRequest,
  ConvertorRequest,
  GeocodeRequest,
  GeocodedAddress,
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
  JsapiV4ServiceDriver,
  LocalCityFix,
  PlaceSuggestion,
  ReverseGeocodeRequest,
  ServiceCall,
  ServiceCallSettle,
} from "../types/services";
import {
  assertJsapiV4Namespace,
  callRequired,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/* -------------------------------------------------------------------------- */
/* raw 形状（结构化访问，不引入官方类型）                                        */
/* -------------------------------------------------------------------------- */

interface RawPoint {
  lng: number;
  lat: number;
}

interface RawTranslatePayload {
  status?: number;
  points?: RawPoint[];
  message?: string;
}

interface RawBoundaryPayload {
  boundaries?: unknown;
}

interface RawGeolocationPayload {
  point?: RawPoint;
  accuracy?: number;
  address?: GeolocationAddressInfo;
}

interface RawLocalCityPayload {
  name?: string;
  center?: RawPoint;
  level?: number;
}

interface RawAutocompletePoi {
  province?: string;
  city?: string;
  district?: string;
  street?: string;
  streetNumber?: string;
  business?: string;
}

interface RawAutocompleteResult {
  /** 检索关键字（官方 `AutocompleteResult.keyword`；运行时不保证填充） */
  keyword?: string;
  getNumPois?: () => number;
  getPoi?: (index: number) => RawAutocompletePoi | undefined;
}

/* -------------------------------------------------------------------------- */
/* 常量与纯函数                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `Geolocation#getStatus()` 的失败状态码 → 可读原因。
 *
 * 键是**数值字面量**而不是全局 `BMAP_STATUS_*`（Driver 只认 `rawSdk` 传入的命名空间，
 * 不读未经 Provider 校验的全局），与官方 `const/StatusCodes.d.ts` 的一致性由文件末尾的
 * 类型断言钉死。
 */
const GEOLOCATION_FAILURE_REASONS = {
  2: "位置未知",
  6: "定位权限被拒绝",
  7: "定位服务不可用",
  8: "定位超时",
} as const;

/** 六个基础服务 ↔ Catalog 能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const SERVICE_CAPABILITIES = {
  createGeocoder: "service.geocoder",
  createConvertor: "service.convertor",
  createGeolocation: "service.geolocation",
  createLocalCity: "service.local-city",
  createBoundary: "service.boundary",
  createAutocomplete: "service.autocomplete",
} as const satisfies Record<string, Capability>;

export interface CreateJsapiV4ServiceDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

/** 把 `"lng1,lat1;lng2,lat2;…"` 的边界点串解析成坐标数组（非法片段直接丢弃）。 */
export function parseBoundaryRing(value: unknown): Point[] {
  if (typeof value !== "string") return [];
  const ring: Point[] = [];
  for (const pair of value.split(";")) {
    const [lngText, latText] = pair.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);
    if (Number.isFinite(lng) && Number.isFinite(lat)) ring.push({ lng, lat });
  }
  return ring;
}

/** `province + city + district + street` 的结构化地址（`business` 为空时的标题）。 */
function composeAddress(poi: RawAutocompletePoi): string {
  return [poi.province, poi.city, poi.district, poi.street]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("");
}

/** `AutocompleteResult` → 领域条目（`getPoi` / `getNumPois` 是官方唯一读法）。 */
export function readSuggestions(
  results: RawAutocompleteResult | null | undefined,
): PlaceSuggestion[] {
  if (
    !results ||
    typeof results.getNumPois !== "function" ||
    typeof results.getPoi !== "function"
  ) {
    return [];
  }
  const count = results.getNumPois();
  if (!Number.isFinite(count) || count <= 0) return [];
  const suggestions: PlaceSuggestion[] = [];
  for (let index = 0; index < count; index += 1) {
    const poi = results.getPoi(index);
    if (!poi) continue;
    suggestions.push({
      title: poi.business || composeAddress(poi),
      address: composeAddress(poi),
      index,
    });
  }
  return suggestions;
}

/** 读 `Geolocation#getStatus()`；成员缺失或调用失败时返回 `null`（不把缺成员伪装成状态 0）。 */
function readGeolocationStatus(
  raw: Record<string, unknown>,
  warn: (key: string, message: string) => void,
): number | null {
  const fn = readNamespaceMember(raw, "getStatus");
  if (typeof fn !== "function") return null;
  try {
    const status = (fn as () => unknown).call(raw);
    return typeof status === "number" ? status : null;
  } catch (error) {
    warn(
      "geolocation:getStatus",
      `ServiceDriver.locate: Geolocation.getStatus() 调用失败，状态码按未知处理：${
        (error as Error)?.message ?? String(error)
      }`,
    );
    return null;
  }
}

export function createJsapiV4ServiceDriver(
  input: CreateJsapiV4ServiceDriverInput,
): JsapiV4ServiceDriver {
  const { rawSdk, geometry, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  const warnOnce = createWarnOnce();

  /**
   * 同一 `Autocomplete` 实例的 pending 结算**队列**。
   *
   * `Autocomplete#search()` **不带请求身份**：回包除了可选的 `keyword` 之外没有任何可用于
   * 归因的信息。因此归属规则必须与「同一关键词最多只有一个槽位」这条**不变式**配套使用
   * （由 `suggest()` 的前置拒绝保证），否则无论取最早还是取最新的同名项都只是按到达时间猜：
   *
   * 1. 回包**带 `keyword` 且队列里有同名项** ⇒ 取**最早**的同名项（回包与 `search()` 一一对应
   *    并按请求顺序到达；由于同关键词只有一个槽位，取最早即等于「就是它自己的那个」）；
   * 2. 回包**带 `keyword` 但队列里没有同名项** ⇒ **不消费任何槽位**（不属于任何 `suggest()`，
   *    或属于已被上界丢掉的旧请求）——落回 FIFO 会把用户输入触发的回包结算给下一个调用；
   * 3. 回包**不带 `keyword`**（运行时是否填充未在文档中承诺）⇒ 退化为**先进先出**。
   *
   * 两个直接推论：
   * - **被取消 / 已超时的那次 `search()` 的回包仍会到达**（SDK 没有取消入口），所以取消不能
   *   从队列里删掉自己的槽位——否则它的迟到回包会去结算**下一个**调用（旧结果污染新请求）；
   * - 取消 / 超时后的结算由适配器的「先到者胜」吸收（已结算的 `ServiceCall` 再收到 `success`
   *   是 no-op），墓碑只需要保证数量对齐；墓碑在自己那个回包到达时被移除。
   */
  const pendingSuggest = new WeakMap<
    object,
    Array<{ keyword: string; settle: ServiceCallSettle<PlaceSuggestion[]> }>
  >();

  /**
   * 待回包队列的上限。**达到上限时拒绝新调用，而不是淘汰旧记录**（PR #63 四轮复审 P2-1）：
   * 淘汰并不会取消 SDK 请求，被淘汰的请求的回包仍会到达；一旦它的关键词又出现在队列里
   * （例如取消旧 K 之后再查 K），那个回包就会被错误地结算给新调用。上限只作为「SDK 长期
   * 不回包」时的资源护栏，失败是显式的。
   */
  const MAX_PENDING_SUGGESTS = 16;

  const isQueueFull = (raw: Record<string, unknown>): boolean =>
    (pendingSuggest.get(raw)?.length ?? 0) >= MAX_PENDING_SUGGESTS;

  const enqueueSuggest = (
    raw: Record<string, unknown>,
    keyword: string,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw) ?? [];
    queue.push({ keyword, settle });
    pendingSuggest.set(raw, queue);
  };

  /** `search()` 同步抛错时回滚刚入队的槽位（没有请求就没有回包，留着会永久错位）。 */
  const dequeueSuggest = (
    raw: Record<string, unknown>,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw);
    if (!queue) return;
    const index = queue.findIndex((entry) => entry.settle === settle);
    if (index >= 0) queue.splice(index, 1);
  };

  /**
   * 取出本次回包对应的 pending 结算（判定规则见 `pendingSuggest` 的注释）。
   *
   * 队列为空、或**回包带了 keyword 但队列里没有同名项**时返回 `null`：那种回包既不属于任何
   * `suggest()`（用户在输入框里打字会触发同一条 `onSearchComplete`），也可能是已被队列上界
   * 丢掉的旧请求的迟到回包。落回 FIFO 会把它结算给队列里的**下一个**调用（旧结果污染新请求），
   * 所以这里必须**不消费任何槽位**。
   */
  const shiftPending = (
    raw: Record<string, unknown>,
    results: RawAutocompleteResult | null | undefined,
  ): ServiceCallSettle<PlaceSuggestion[]> | null => {
    const queue = pendingSuggest.get(raw);
    if (!queue || queue.length === 0) return null;

    const keyword = typeof results?.keyword === "string" ? results.keyword : null;
    if (keyword === null) {
      // 回包不带 keyword（官方只承诺「可选」）⇒ 只能按顺序退化到队首
      return queue.shift()?.settle ?? null;
    }
    // 带 keyword ⇒ 取**最早**的同名项：回包与 `search()` 一一对应、且按请求顺序到达，
    // 因此最早那个就是本次回包的归属。取最新会把**旧回包塞给新请求**（三轮复审用「按请求
    // 顺序正常返回」的反例证明了这一点）。
    const index = queue.findIndex((entry) => entry.keyword === keyword);
    if (index < 0) return null;
    const [entry] = queue.splice(index, 1);
    return entry?.settle ?? null;
  };

  /**
   * 该关键词是否已有未完成的槽位（含已取消 / 已超时、但仍在等自己那个回包的墓碑）。
   *
   * `suggest()` 用它做**前置拒绝**：同关键词的重叠请求无法被归属（见 `suggest` 的注释），
   * 拒绝之后同一关键词在任意时刻最多只有一个槽位，回包归属与到达顺序无关。
   */
  const hasPendingKeyword = (raw: Record<string, unknown>, keyword: string): boolean =>
    (pendingSuggest.get(raw) ?? []).some((entry) => entry.keyword === keyword);

  /**
   * 回调通道**独占**的判定（五轮复审 P2 之后）。
   *
   * `Autocomplete` 只有一条 `onSearchComplete`，用户输入触发的检索与程序化 `search()` 共用它，
   * 而回包里没有任何「这次是谁触发的」信息——因此**可输入的实例上，同关键词的原生回包与程序化
   * 回包无法区分**。判定必须看输入框的**当前**状态（HTML 控件的可编辑性取决于当前的
   * `disabled` / `readonly` / `type`，构造之后随时可能变回可输入），所以：
   *
   * - `boundInput`：保留输入框引用，在**每次 `suggest()` 与每次回包**时重新校验；
   * - `lostExclusivity`：一旦观察到可输入就**永久失效**（不因为随后又变回只读而恢复资格——
   *   可编辑期间触发的旧请求可能仍在等回包），此后的 `suggest()` 与回包都明确失败/忽略，
   *   调用方需重建实例。
   *
   * 为什么不直接建一个「程序化专用实例」：真实 4.0 里不带 `input` 的实例**能构造但 `search()`
   * 不回包**（smoke 实测：`no-input` / `input: undefined` 都是「构造 ok；3s 内回包数=0」），
   * 而挂到文档的输入框才是 `search()` 能回包的前提——所以独占通道只能由调用方用「不可输入的
   * 输入框」表达，Driver 不替它造 DOM（DOM 所有权与释放路径都留在调用方一侧）。
   */
  const boundInput = new WeakMap<object, unknown>();
  const lostExclusivity = new WeakSet<object>();
  /** 已被 `dispose()` 释放的实例：此后一律拒绝（释放时会把在飞调用显式失败）。 */
  const disposed = new WeakSet<object>();
  /**
   * 绑定输入框上的「用户输入活动」监听（`input` 事件）——**释放路径见 `releaseInputWatcher`**。
   *
   * 六轮曾用 `MutationObserver` 观察属性变化，但**「属性被写过」不等于「曾经可输入」**（七轮复审
   * P2-2）：真实 Chromium 里 `input.readOnly = true` 重复赋同值同样会产生一条记录，于是「始终只读、
   * 只是随 loading 切 `disabled`」这类完全安全的用法会被永久禁用。
   *
   * 改为监听**输入活动**：它才是官方文档里原生检索的触发源（「输入框中的字符输入会触发检索」），
   * 既不误伤属性写入，又覆盖了 `解除只读 → 用户输入 → 恢复只读` 那个没有观察点的窗口。
   */
  const inputWatchers = new WeakMap<object, { target: EventTarget; listener: EventListener }>();

  /** 输入框是否可被用户输入（决定回调通道是否独占）。缺输入框时按「不独占」处理。 */
  const isTypableInput = (input: unknown): boolean => {
    if (typeof input !== "object" || input === null) return false;
    const el = input as { readOnly?: unknown; disabled?: unknown; type?: unknown };
    if (el.readOnly === true || el.disabled === true) return false;
    return el.type !== "hidden";
  };

  const EXCLUSIVITY_LOST_HINT = "请重建 Autocomplete 实例（用不可输入的输入框）后再做程序化检索";

  /**
   * 解绑输入框上的输入活动监听。**这是监听器的唯一释放路径**，必须在实例进入终态时调用
   * （失去独占 / 被 `dispose()`）：输入框通常比实例活得久，不解绑就会让监听器长期持有旧的 raw
   * 实例与闭包（七轮复审 P2-1）。
   */
  const releaseInputWatcher = (raw: Record<string, unknown>): void => {
    const watcher = inputWatchers.get(raw);
    if (!watcher) return;
    inputWatchers.delete(raw);
    try {
      watcher.target.removeEventListener("input", watcher.listener);
    } catch {
      /* 解绑失败不阻断：输入框可能已被替换或宿主未完整实现 EventTarget */
    }
  };

  /**
   * 标记实例失去独占，并把在飞的程序化请求**显式失败**：那些回包可能来自用户输入，不能再被当成
   * 程序化检索的结果（宁可失败也不猜）。永久生效，见 `lostExclusivity`。
   */
  const loseExclusivity = (raw: Record<string, unknown>, reason: string): void => {
    if (lostExclusivity.has(raw)) return;
    lostExclusivity.add(raw);
    // 释放路径：监听器只在「实例可能被用于程序化检索」期间需要，终止态一定解绑，
    // 不留下持有输入框与闭包的活监听器。
    releaseInputWatcher(raw);
    const queue = pendingSuggest.get(raw) ?? [];
    pendingSuggest.delete(raw);
    for (const entry of queue) {
      entry.settle.failed({ code: "BMAP_SERVICE_FAILED", message: reason });
    }
  };

  /**
   * 开始监听输入框的**输入活动**（`input` 事件）。
   *
   * 绑定失败时静默退化为「每次检查当前状态」——监听能力缺失不应让实例不可用。
   */
  const watchInputActivity = (raw: Record<string, unknown>, input: unknown): void => {
    if (typeof input !== "object" || input === null) return;
    const target = input as Partial<EventTarget>;
    if (typeof target.addEventListener !== "function") return;
    const listener: EventListener = () => {
      loseExclusivity(
        raw,
        "该 Autocomplete 实例绑定的输入框在实例使用期间收到过用户输入：用户输入会触发原生检索，" +
          "其回包与程序化检索无法区分（可能把用户那次的结果当成程序化调用的结果）；" +
          EXCLUSIVITY_LOST_HINT,
      );
    };
    try {
      target.addEventListener("input", listener);
      inputWatchers.set(raw, { target: target as EventTarget, listener });
    } catch {
      /* 非 DOM 环境等：退化为每次检查当前状态 */
    }
  };

  /** 每次调用 / 每次回包都要跑的独占校验；返回失败原因（null 表示仍然独占）。 */
  const exclusivityFailure = (raw: Record<string, unknown>): string | null => {
    if (disposed.has(raw)) {
      return "该服务实例已被 dispose() 释放：请重建实例后再做程序化检索";
    }
    if (lostExclusivity.has(raw)) {
      return `该 Autocomplete 实例已失去回调通道独占（输入框曾可输入、或收到过用户输入）：${EXCLUSIVITY_LOST_HINT}`;
    }
    if (isTypableInput(boundInput.get(raw))) {
      const message =
        "该 Autocomplete 实例绑定的输入框当前可输入：用户输入触发的检索与程序化检索共用同一条 " +
        "onSearchComplete，关键词相同时回包无法区分（可能把用户那次的结果当成程序化调用的结果）。" +
        `请用不可输入的输入框（readOnly / disabled / type="hidden"）创建程序化检索实例，` +
        `或改用该实例的 onSearchComplete 回调；${EXCLUSIVITY_LOST_HINT}`;
      loseExclusivity(raw, message);
      return message;
    }
    return null;
  };

  /** 空结果还是失败：`null` 回包 + JSONP 注册表里的错误码 ⇒ 失败。 */
  const settleNull = <T>(
    settle: ServiceCallSettle<T>,
    probe: JsonpErrorCapture,
    label: string,
  ): void => {
    const error = probe.getLastError();
    if (error) {
      settle.failed({ code: error.code, message: error.message || `${label} 服务端返回错误` });
      return;
    }
    settle.empty();
  };

  /** 参数不合法的调用：适配器不抛错，因此以 `failed` 结算（`BMAP_INVALID_ARGUMENT`）。 */
  const invalidCall = <T>(label: string, message: string): ServiceCall<T> =>
    createServiceCall<T>(
      (settle) =>
        settle.failed({ code: "BMAP_INVALID_ARGUMENT", message: `${label}: ${message}` }),
      { label },
    );

  /**
   * 前置条件不满足的调用（不是参数问题，也不是 SDK 调用失败）：以 `failed` 结算
   * （`BMAP_SERVICE_FAILED`），不抛错、不猜。
   */
  const serviceFailedCall = <T>(label: string, message: string): ServiceCall<T> =>
    createServiceCall<T>(
      (settle) => settle.failed({ code: "BMAP_SERVICE_FAILED", message: `${label}: ${message}` }),
      { label },
    );

  const resolve = <T>(handle: SdkHandle<string>, facet: string): T => {
    try {
      return registry.resolve<T>(handle);
    } catch (error) {
      throw new BMapError(
        "BMAP_HANDLE_FOREIGN",
        `${facet}: 句柄不属于当前 Client，或不是本 Facet 创建的句柄（${
          (error as Error)?.message ?? String(error)
        }）`,
        { cause: error, engine: "jsapi-v4" },
      );
    }
  };

  const geocoderOf = (handle: ServiceHandle<"service:geocoder">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.geocode");
  const convertorOf = (handle: ServiceHandle<"service:convertor">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.convert");
  const boundaryOf = (handle: ServiceHandle<"service:boundary">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.queryBoundary");
  const geolocationOf = (handle: ServiceHandle<"service:geolocation">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.locate");
  const localCityOf = (handle: ServiceHandle<"service:local-city">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.locateCity");

  return {
    /* ------------------------------------------------------------ 创建面 */

    createGeocoder() {
      capabilities.require(SERVICE_CAPABILITIES.createGeocoder);
      const Geocoder = namespaceCtor(namespace, "Geocoder");
      return registry.adopt("service:geocoder", sdkCall("Geocoder", () => new Geocoder()));
    },

    createConvertor() {
      capabilities.require(SERVICE_CAPABILITIES.createConvertor);
      const Convertor = namespaceCtor(namespace, "Convertor");
      return registry.adopt("service:convertor", sdkCall("Convertor", () => new Convertor()));
    },

    createGeolocation(options = {}) {
      capabilities.require(SERVICE_CAPABILITIES.createGeolocation);
      const Geolocation = namespaceCtor(namespace, "Geolocation");
      return registry.adopt(
        "service:geolocation",
        sdkCall("Geolocation", () => new Geolocation(options)),
      );
    },

    createLocalCity(options = {}) {
      capabilities.require(SERVICE_CAPABILITIES.createLocalCity);
      const LocalCity = namespaceCtor(namespace, "LocalCity");
      return registry.adopt(
        "service:local-city",
        sdkCall("LocalCity", () => new LocalCity(options)),
      );
    },

    createBoundary() {
      capabilities.require(SERVICE_CAPABILITIES.createBoundary);
      const Boundary = namespaceCtor(namespace, "Boundary");
      return registry.adopt("service:boundary", sdkCall("Boundary", () => new Boundary()));
    },

    createAutocomplete(options: AutocompleteOptions) {
      capabilities.require(SERVICE_CAPABILITIES.createAutocomplete);
      const Autocomplete = namespaceCtor(namespace, "Autocomplete");
      const location =
        options.location && typeof options.location === "object" && "lng" in options.location
          ? geometry.toRawPoint(options.location as Point)
          : options.location;

      // 内部分发器：先按 FIFO 结算属于自己的那个 pending，再把同一个回调转给调用方自己的监听。
      let raw: Record<string, unknown> | null = null;
      const instance = sdkCall("Autocomplete", () =>
        new Autocomplete({
          location,
          input: options.input,
          types: options.types,
          onSearchComplete: (results: RawAutocompleteResult) => {
            let settle: ServiceCallSettle<PlaceSuggestion[]> | null = null;
            if (raw) {
              // 独占在**每次回包**时重新校验：等待期间输入框变回可输入 ⇒ 这个回包可能来自用户输入，
              // 一律不接受（把在飞的程序化请求显式失败，并让实例永久失效）
              if (exclusivityFailure(raw) === null) settle = shiftPending(raw, results);
            }
            if (settle) {
              const suggestions = readSuggestions(results);
              if (suggestions.length > 0) settle.success(suggestions);
              else settle.empty();
            }
            options.onSearchComplete?.(results);
          },
        }),
      );
      raw = instance as unknown as Record<string, unknown>;
      // 记下输入框**引用**：独占判定在每次 `suggest()` 与每次回包时重新校验（见 `boundInput`）；
      // 另外监听它的**输入活动**——只看当前状态发现不了「检查间隔内发生过的输入」（见 `inputWatchers`）
      boundInput.set(raw, options.input);
      watchInputActivity(raw, options.input);
      return registry.adopt("service:autocomplete", instance);
    },

    createViewAnimation(keyFrames, options = {}) {
      const ViewAnimation = namespaceCtor(namespace, "ViewAnimation");
      const frames = keyFrames.map((frame) => ({
        ...frame,
        center:
          frame.center && typeof frame.center === "object"
            ? geometry.toRawPoint(frame.center as Point)
            : frame.center,
      }));
      const animation = sdkCall("ViewAnimation", () =>
        new ViewAnimation(frames, {
          duration: (options.duration as number) ?? 1000,
          delay: (options.delay as number) ?? 0,
          interation: (options.interation ?? options.loop ?? 1) as number | "INFINITE",
        }),
      );
      return registry.adopt("service:view-animation", animation);
    },

    createTrackAnimation(_map: MapHandle) {
      // Catalog：`service.track-animation` 是 `unsupported`（迁移结论属 M8 #43）。
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        "JSAPI 4.0 没有 TrackAnimation 入口（该插件属 BMapGLLib，迁移结论待 M8 #43 定夺）；" +
          "4.0 的对应能力是原生图层 TrackLine（driver.nativeLayers.create('track-line')）",
        { engine: "jsapi-v4", capability: "service.track-animation" },
      );
    },

    /**
     * 释放服务实例（Driver 侧释放入口，七轮复审 P2-1）。
     *
     * 官方 `Autocomplete` 有 `dispose()`，但它不知道 Driver 另外挂在输入框上的监听器；**释放必须由
     * Driver 自己提供入口**，否则「输入框一直保持只读、实例正常结束使用」这条路径上监听器永远不会
     * 解绑（输入框通常比实例活得久 → 监听器长期持有旧 raw 与闭包，反复创建/销毁会持续累积）。
     *
     * 语义：① 幂等；② 先释放 Driver 侧资源（输入活动监听 + 把在飞调用显式失败），再调用 SDK 自身的
     * `dispose()`（实例没有该成员时跳过，不算错误）；③ 释放后该句柄不再可用于程序化检索。
     */
    dispose(handle: ServiceHandle<string>) {
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.dispose");
      if (disposed.has(raw)) return;
      disposed.add(raw);

      releaseInputWatcher(raw);
      const queue = pendingSuggest.get(raw) ?? [];
      pendingSuggest.delete(raw);
      for (const entry of queue) {
        entry.settle.failed({
          code: "BMAP_SERVICE_FAILED",
          message: "该服务实例在请求进行中被 dispose() 释放",
        });
      }

      // SDK 自身的释放（官方 Autocomplete#dispose）：没有该成员的实例直接跳过
      const disposeMember = readNamespaceMember(raw, "dispose");
      if (typeof disposeMember === "function") {
        sdkCall("Service.dispose", () => callRequired(raw, "dispose"));
      }
    },

    /* -------------------------------------------------------- 归一化调用面 */

    geocode(handle, request: GeocodeRequest) {
      const address = request?.address;
      if (typeof address !== "string" || address.length === 0) {
        return invalidCall<Point>("Geocoder.getPoint", "address 必须是非空字符串");
      }
      const raw = geocoderOf(handle);
      // 顺序与 composable 层一致：SDK 在调用内同步注册 _rd 回调，先调用再 rescan 包装；
      // JSONP 回包恒为异步，因此 rescan 必定先于回包执行。
      const probe = captureJsonpServiceError(rawSdk);
      return createServiceCall<Point>(
        (settle) => {
          callRequired(
            raw,
            "getPoint",
            address,
            (point: RawPoint | null) => {
              if (!point) {
                settleNull(settle, probe, "Geocoder.getPoint");
                return;
              }
              settle.success(toPlainPoint(point));
            },
            request.city,
          );
          probe.rescan();
        },
        { label: "Geocoder.getPoint" },
      );
    },

    reverseGeocode(handle, request: ReverseGeocodeRequest) {
      const point = request?.point;
      if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
        return invalidCall<GeocodedAddress>("Geocoder.getLocation", "point 必须是 { lng, lat }");
      }
      const raw = geocoderOf(handle);
      const probe = captureJsonpServiceError(rawSdk);
      const options: Record<string, unknown> = {};
      if (typeof request.poiRadius === "number") options.poiRadius = request.poiRadius;
      if (typeof request.numPois === "number") options.numPois = request.numPois;

      return createServiceCall<GeocodedAddress>(
        (settle) => {
          callRequired(
            raw,
            "getLocation",
            geometry.toRawPoint(point),
            (
              result: {
                address?: string;
                point?: RawPoint;
                business?: string;
                surroundingPois?: unknown[];
              } | null,
            ) => {
              if (!result) {
                settleNull(settle, probe, "Geocoder.getLocation");
                return;
              }
              settle.success({
                address: typeof result.address === "string" ? result.address : "",
                point: result.point ? toPlainPoint(result.point) : null,
                business: typeof result.business === "string" ? result.business : null,
                poiCount: Array.isArray(result.surroundingPois)
                  ? result.surroundingPois.length
                  : 0,
              });
            },
            options,
          );
          probe.rescan();
        },
        { label: "Geocoder.getLocation" },
      );
    },

    convert(handle, request: ConvertorRequest) {
      const points = request?.points;
      if (!Array.isArray(points) || points.length === 0) {
        return invalidCall<Point[]>("Convertor.translate", "points 必须是非空数组");
      }
      // 坐标合法性**必须在进入调用之前校验**：几何边界会以 `BMAP_INVALID_POINT` 拒绝非有限数
      // / 缺分量，而它是在 `createServiceCall` 之外执行的——不先拦下来就会同步抛错，
      // 连 `ServiceCall` 都返回不了（PR #63 复审 P2-4）。**先校验容器，再逐项读分量**：
      // `points` 里出现 null / 非对象时也不能抛原生 TypeError。
      for (const point of points) {
        const candidate = point as { lng?: unknown; lat?: unknown } | null | undefined;
        const lng = candidate?.lng;
        const lat = candidate?.lat;
        if (typeof lng !== "number" || !Number.isFinite(lng) || typeof lat !== "number" || !Number.isFinite(lat)) {
          return invalidCall<Point[]>(
            "Convertor.translate",
            `points 里存在非法坐标（缺失分量或非有限数）: ${JSON.stringify(point) ?? String(point)}`,
          );
        }
      }
      const raw = convertorOf(handle);
      return createServiceCall<Point[]>(
        (settle) => {
          // 放在受保护流程里：几何转换若仍抛出（例如上游加了别的校验），也走 `failed`
          // 而不是从 `ServiceCall` 之外逃逸。
          const rawPoints = geometry.toRawPoints(points);
          callRequired(
            raw,
            "translate",
            rawPoints,
            request.from,
            request.to,
            (result: RawTranslatePayload | null) => {
              if (!result || typeof result.status !== "number") {
                settle.empty();
                return;
              }
              if (result.status !== 0) {
                settle.failed(
                  {
                    code: result.status,
                    message: result.message || `坐标转换失败（status ${result.status}）`,
                  },
                  result.status,
                );
                return;
              }
              const converted = Array.isArray(result.points) ? result.points : [];
              if (converted.length === 0) {
                settle.empty(result.status);
                return;
              }
              settle.success(converted.map(toPlainPoint), result.status);
            },
          );
        },
        { label: "Convertor.translate" },
      );
    },

    queryBoundary(handle, request: BoundaryRequest) {
      const name = request?.name;
      if (typeof name !== "string" || name.length === 0) {
        return invalidCall<Point[][]>("Boundary.get", "name 必须是非空字符串");
      }
      const raw = boundaryOf(handle);
      const probe = captureJsonpServiceError(rawSdk);
      return createServiceCall<Point[][]>(
        (settle) => {
          callRequired(raw, "get", name, (result: RawBoundaryPayload | null) => {
            if (!result || !Array.isArray(result.boundaries)) {
              settleNull(settle, probe, "Boundary.get");
              return;
            }
            const rings = (result.boundaries as unknown[])
              .map(parseBoundaryRing)
              .filter((ring) => ring.length > 0);
            if (rings.length === 0) settle.empty();
            else settle.success(rings);
          });
          probe.rescan();
        },
        { label: "Boundary.get" },
      );
    },

    locate(handle, options: GeolocationOptions = {}) {
      const raw = geolocationOf(handle);
      return createServiceCall<GeolocationFix>(
        (settle) => {
          callRequired(
            raw,
            "getCurrentPosition",
            (result: RawGeolocationPayload | null) => {
              // `Geolocation` 是唯一自带状态码的服务（`BMAP_STATUS_*`）。
              const status = readGeolocationStatus(raw, warnOnce);
              if (!result || (status !== null && status !== 0)) {
                settle.failed(
                  {
                    code: status ?? "BMAP_SERVICE_FAILED",
                    message:
                      status !== null
                        ? `定位失败：${
                            GEOLOCATION_FAILURE_REASONS[
                              status as keyof typeof GEOLOCATION_FAILURE_REASONS
                            ] ?? `状态码 ${status}`
                          }`
                        : "定位失败：SDK 未返回结果",
                  },
                  status,
                );
                return;
              }
              const point = result.point;
              if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
                settle.empty(status);
                return;
              }
              settle.success(
                {
                  point: toPlainPoint(point),
                  accuracy: typeof result.accuracy === "number" ? result.accuracy : null,
                  address: result.address ?? null,
                },
                status,
              );
            },
            options,
          );
        },
        { label: "Geolocation.getCurrentPosition" },
      );
    },

    locateCity(handle) {
      const raw = localCityOf(handle);
      // 与 Geocoder / Boundary 同源：失败时官方只回 null，服务端错误码只在 JSONP 注册表里，
      // 不接探针就会把「服务失败」归类成「查不到城市」（PR #63 复审 P2-3）。
      const probe = captureJsonpServiceError(rawSdk);
      return createServiceCall<LocalCityFix>(
        (settle) => {
          callRequired(raw, "get", (result: RawLocalCityPayload | null) => {
            const name = typeof result?.name === "string" ? result.name : "";
            if (!name) {
              // 先看错误码：有错误 ⇒ failed（业务才能提示 / 重试），没有 ⇒ 真的查不到
              settleNull(settle, probe, "LocalCity.get");
              return;
            }
            settle.success({
              name,
              center: result?.center ? toPlainPoint(result.center) : null,
              level: typeof result?.level === "number" ? result.level : null,
            });
          });
          probe.rescan();
        },
        { label: "LocalCity.get" },
      );
    },

    suggest(handle, keyword: string) {
      if (typeof keyword !== "string" || keyword.length === 0) {
        return invalidCall<PlaceSuggestion[]>("Autocomplete.search", "keyword 必须是非空字符串");
      }
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.suggest");

      // 前置拒绝 1（通道独占）：在**调用时**校验输入框的当前状态，而不是只信构造时的标记——
      // HTML 控件的可编辑性随时可变，构造后恢复可输入同样会让两类回包无法区分（五轮复审 P2）。
      const exclusivity = exclusivityFailure(raw);
      if (exclusivity !== null) {
        return serviceFailedCall<PlaceSuggestion[]>("Autocomplete.search", exclusivity);
      }

      // 前置拒绝 2（同关键词互斥）：`Autocomplete` 的回包不带请求身份，两次同名请求的回包互相
      // 不可区分——旧回包先到会把旧结果塞给新请求，新回包先到又会让旧请求失效（两种情况都在
      // PR #63 的复审里被复现过）。拒绝之后同一关键词在任意时刻最多只有一个槽位，归属与到达
      // 顺序无关。彻底的隔离（每次请求一个独立实例 + 回调闭包）属 M7（#38 / #41），见 ADR。
      if (hasPendingKeyword(raw, keyword)) {
        return serviceFailedCall<PlaceSuggestion[]>(
          "Autocomplete.search",
          `同一 Autocomplete 实例上已有关键词 "${keyword}" 的未完成请求：Autocomplete 的回包不带请求标识，` +
            "本次与它的回包无法区分（旧结果可能被当成新结果）；请等它结算后再查，或改用不同关键词",
        );
      }
      if (isQueueFull(raw)) {
        return serviceFailedCall<PlaceSuggestion[]>(
          "Autocomplete.search",
          `同一 Autocomplete 实例上等待回包的程序化检索已达上限 ${MAX_PENDING_SUGGESTS}：` +
            "旧请求的记录必须保留到它的回包到达为止（淘汰它们会让迟到回包被错误归属），请等待结算后再查",
        );
      }

      // 刻意**不传 `onCancel`**：取消只影响本次 `ServiceCall` 的结果（由适配器结算成
      // `canceled`），队列槽位必须留在原处吸收那次 search 的回包——理由见 `pendingSuggest`。
      return createServiceCall<PlaceSuggestion[]>(
        (settle) => {
          enqueueSuggest(raw, keyword, settle);
          try {
            callRequired(raw, "search", keyword);
          } catch (error) {
            // 请求没发出去就不会有回包：回滚槽位，否则队列会永久错位一格
            dequeueSuggest(raw, settle);
            throw error;
          }
        },
        { label: "Autocomplete.search" },
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 地理定位失败状态码与官方 `const/StatusCodes.d.ts` 一致。
 *
 * 上游改值即编译失败——比注释里写「与官方一致」可靠（同 #22 的锚点常量表口径）。
 */
type _AssertGeolocationFailureStatus =
  | typeof BMAP_STATUS_UNKNOWN_LOCATION
  | typeof BMAP_STATUS_PERMISSION_DENIED
  | typeof BMAP_STATUS_SERVICE_UNAVAILABLE
  | typeof BMAP_STATUS_TIMEOUT;
type _AssertGeolocationFailureReasons = ExpectTrue<
  _AssertGeolocationFailureStatus extends keyof typeof GEOLOCATION_FAILURE_REASONS ? true : false
>;

/** 创建面用到的构造器名必须真的在官方 `BMap` 命名空间上。 */
type ServiceCtorName =
  | "Geocoder"
  | "Convertor"
  | "Geolocation"
  | "LocalCity"
  | "Boundary"
  | "Autocomplete"
  | "ViewAnimation";
type _AssertServiceCtors = ExpectTrue<ServiceCtorName extends keyof typeof BMap ? true : false>;
