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
   * 同一 `Autocomplete` 实例的 pending 结算**队列**（先进先出）。
   *
   * `Autocomplete#search()` 不带请求标识，表面上无法把回包对应回某次调用；但一次
   * `search()` **必定**换来恰好一次 `onSearchComplete`（用户在输入框里打字也走同一条路），
   * 因此回包归属只能是**数量对齐的先进先出**：第 N 个回包属于第 N 次 `search()`。
   *
   * 两个直接推论（PR #63 复审 P2-1，两种错法都真的发生过）：
   * - **被取消的那次 `search()` 的回包仍会到达**（SDK 没有取消入口），所以 `cancel()` 不能
   *   从队列里删掉自己的槽位——否则它的迟到回包会去结算**下一个**调用（旧结果污染新请求）；
   * - 取消后的结算由适配器的「先到者胜」吸收（已结算的 `ServiceCall` 再收到 `success` 是
   *   no-op），队列只需要保证数量对齐。同理也能容纳「`suggest()` 超时之后才到的回包」。
   */
  const pendingSuggest = new WeakMap<object, ServiceCallSettle<PlaceSuggestion[]>[]>();

  /** `search()` 数量与回包数量长期不匹配时的队列上界（自愈用，不是正常路径）。 */
  const MAX_PENDING_SUGGESTS = 16;

  const enqueueSuggest = (
    raw: Record<string, unknown>,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw) ?? [];
    queue.push(settle);
    if (queue.length > MAX_PENDING_SUGGESTS) {
      queue.shift();
      warnOnce(
        "suggest:backlog",
        `ServiceDriver.suggest: 同一个 Autocomplete 的 pending 回包已超过 ${MAX_PENDING_SUGGESTS} 个，` +
          "丢弃最旧的一个（SDK 回包数量长期少于 search 次数时会走到这里）",
      );
    }
    pendingSuggest.set(raw, queue);
  };

  /** `search()` 同步抛错时回滚刚入队的槽位（没有请求就没有回包，留着会永久错位）。 */
  const dequeueSuggest = (
    raw: Record<string, unknown>,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw);
    if (queue && queue[queue.length - 1] === settle) queue.pop();
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
            // 取队首（最老的一次 search）：回包与 search 一一对应，因此队首就是本次回包的归属。
            // 队列为空说明这次回包不属于任何 `suggest()`（用户在输入框里打字），直接转发给业务。
            const settle = raw ? (pendingSuggest.get(raw)?.shift() ?? null) : null;
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
      // 刻意**不传 `onCancel`**：取消只影响本次 `ServiceCall` 的结果（由适配器结算成
      // `canceled`），队列槽位必须留在原处吸收那次 search 的回包——理由见 `pendingSuggest`。
      return createServiceCall<PlaceSuggestion[]>(
        (settle) => {
          enqueueSuggest(raw, settle);
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
