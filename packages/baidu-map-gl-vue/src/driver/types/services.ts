/**
 * ServiceDriver
 *
 * SDK 服务类(Geocoder/Convertor/Geolocation/LocalCity/Boundary/Autocomplete/
 * ViewAnimation/TrackAnimation)统一由 Driver 创建，业务层拿 ServiceHandle。
 *
 * 分两层（M3A2-SERVICES-NATIVE / issue #23）：
 * - **创建面** `ServiceDriver`：两个引擎都要实现（webgl-v1 随 #26 删除）；
 * - **归一化调用面** `ServiceInvocationDriver`：把 SDK 的 callback 风格调用收敛成
 *   `ServiceCall<ServiceResult<T>>`，只在 JSAPI 4.0 上落地（见
 *   `docs/adr/2026-09-12-jsapi-v4-service-panorama-native-layers.md`）。
 */
import type { MapHandle, ServiceHandle } from "./handles";
import type { Point } from "./geometry";

export interface AutocompleteOptions {
  input: HTMLInputElement;
  location?: unknown;
  types?: string[];
  onSearchComplete?: (event: unknown) => void;
}

export interface ServiceDriver {
  createGeocoder(): ServiceHandle<"service:geocoder">;
  createConvertor(): ServiceHandle<"service:convertor">;
  createGeolocation(options?: Record<string, unknown>): ServiceHandle<"service:geolocation">;
  createLocalCity(): ServiceHandle<"service:local-city">;
  createBoundary(): ServiceHandle<"service:boundary">;
  createAutocomplete(options: AutocompleteOptions): ServiceHandle<"service:autocomplete">;
  createViewAnimation(
    keyFrames: readonly Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:view-animation">;
  createTrackAnimation(
    map: MapHandle,
    path: readonly Point[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:track-animation">;
}

/* -------------------------------------------------------------------------- */
/* 归一化服务调用（callback → Promise<Result>）                                  */
/* -------------------------------------------------------------------------- */

/**
 * 归一化调用的终态。
 *
 * 刻意把「回调到了」与「业务上有没有结果」拆开：SDK 失败时经常只回 `null`
 * （配额 302 / Referer 限制），把它当成「查无结果」会让业务分不清「没有」与「失败」。
 */
export type ServiceCallStatus = "success" | "empty" | "failed" | "timeout" | "canceled";

export interface ServiceErrorInfo {
  /** SDK 状态码（`BMAP_STATUS_*` / JSONP 错误码）或项目错误码；无从获得时为 `null` */
  code: number | string | null;
  message: string;
}

export interface ServiceResult<T> {
  readonly status: ServiceCallStatus;
  /** 只在 `success` 时非空 */
  readonly data: T | null;
  /** `success` / `empty` / `canceled` 时为 `null` */
  readonly error: ServiceErrorInfo | null;
  /** SDK 原始状态码（`BMAP_STATUS_*`）；适配器拿不到时为 `null` */
  readonly sdkStatus: number | null;
}

/**
 * 传给适配器的结算入口。
 *
 * **先到者胜**：`success`/`empty`/`failed` 任何一个先调用之后，后续（迟到）的结算都被
 * 忽略——真实服务会在超时后仍回包，不设这道门就会把已超时的结果写回去。
 */
export interface ServiceCallSettle<T> {
  success(data: T, sdkStatus?: number | null): void;
  empty(sdkStatus?: number | null): void;
  failed(error: ServiceErrorInfo, sdkStatus?: number | null): void;
}

export interface ServiceCallOptions {
  /** 调用标签（进入超时与失败信息，如 `Geocoder.getPoint`） */
  label: string;
  /** 超时毫秒；默认 `SERVICE_CALL_TIMEOUT_MS` */
  timeoutMs?: number;
  /**
   * 取消时执行。
   *
   * 百度服务大多**没有**取消入口（JSONP 请求发出去就收不回），因此这里只做「放弃结果 +
   * 解绑监听」；`result` 会立刻以 `canceled` 结算，之后到达的回调被忽略。
   */
  onCancel?: () => void;
}

export interface ServiceCall<T> {
  /** **恒 resolve**（不 reject）：失败/超时/取消都走 `status` */
  readonly result: Promise<ServiceResult<T>>;
  cancel(): void;
}

/* -------------------------------------------------- 各服务的请求与结果领域类型 */

/** 正地址解析请求（`Geocoder#getPoint`）。 */
export interface GeocodeRequest {
  address: string;
  /** 地址所在城市名，如 `'北京市'` */
  city?: string;
}

/** 逆地址解析请求（`Geocoder#getLocation`）。 */
export interface ReverseGeocodeRequest {
  point: Point;
  /** 附近 POI 的最大半径（米） */
  poiRadius?: number;
  /** 返回的 POI 个数 */
  numPois?: number;
}

export interface GeocodedAddress {
  address: string;
  point: Point | null;
  /** 所属商圈 */
  business: string | null;
  /** 附近 POI 数量（官方 `surroundingPois` 的长度；只暴露计数，POI 结构属 M7 #38） */
  poiCount: number;
}

/** 坐标转换源/目标类型（官方 `Convertor#translate` 的数值枚举）。 */
export type CoordinateFromType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type CoordinateToType = 3 | 5 | 6;

export interface ConvertorRequest {
  points: readonly Point[];
  from: CoordinateFromType;
  to: CoordinateToType;
}

/** 行政区边界请求（`Boundary#get`）。 */
export interface BoundaryRequest {
  /** 省 / 直辖市 / 地级市 / 县的名称 */
  name: string;
}

export interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  SDKLocation?: boolean;
}

/** 定位结果的地址信息（官方 `GeolocationAddress` 的领域投影）。 */
export interface GeolocationAddressInfo {
  country?: string;
  province?: string;
  city?: string;
  cityCode?: string | number;
  district?: string;
  street?: string;
  streetNumber?: string;
}

export interface GeolocationFix {
  point: Point;
  /** 精度（米）；SDK 未给出时为 `null` */
  accuracy: number | null;
  address: GeolocationAddressInfo | null;
}

/** IP 定位结果（`LocalCity#get`）。 */
export interface LocalCityFix {
  name: string;
  /** SDK 未给出中心点时（`renderOptions.map` 缺失时按官方应恒有）为 `null` */
  center: Point | null;
  level: number | null;
}

/** 输入提示条目（`Autocomplete` 的检索结果）。 */
export interface PlaceSuggestion {
  title: string;
  /** 结构化地址（`province + city + district + street`） */
  address: string;
  /** 条目在列表中的索引；无高亮时为 -1 */
  index: number;
}

/**
 * 归一化调用面（callback → Promise/Result）。
 *
 * 每个方法都返回 `ServiceCall`：**不 reject**，失败/超时/取消都表达成
 * `ServiceResult.status`。
 *
 * 唯一同步抛错的情形是**调用方错误**：`handle` 不是本 Driver 创建的句柄时抛
 * `BMAP_HANDLE_FOREIGN`（跨 Client 混用会操作到另一张地图的资源，必须在边界立刻失败，
 * 而不是伪装成一个「服务失败」的 Result）；参数非法则相反，走结果通道
 * （`status: "failed"` + `BMAP_INVALID_ARGUMENT`），因为它是**调用内容**的问题。
 */
export interface ServiceInvocationDriver {
  /** 地址 → 坐标（`Geocoder#getPoint`） */
  geocode(handle: ServiceHandle<"service:geocoder">, request: GeocodeRequest): ServiceCall<Point>;
  /** 坐标 → 地址（`Geocoder#getLocation`） */
  reverseGeocode(
    handle: ServiceHandle<"service:geocoder">,
    request: ReverseGeocodeRequest,
  ): ServiceCall<GeocodedAddress>;
  /** 坐标系互转（`Convertor#translate`） */
  convert(
    handle: ServiceHandle<"service:convertor">,
    request: ConvertorRequest,
  ): ServiceCall<Point[]>;
  /** 行政区边界（`Boundary#get`）→ 坐标点串数组（每串一个闭合环） */
  queryBoundary(
    handle: ServiceHandle<"service:boundary">,
    request: BoundaryRequest,
  ): ServiceCall<Point[][]>;
  /** 浏览器定位（`Geolocation#getCurrentPosition`） */
  locate(
    handle: ServiceHandle<"service:geolocation">,
    options?: GeolocationOptions,
  ): ServiceCall<GeolocationFix>;
  /** IP 定位城市（`LocalCity#get`） */
  locateCity(handle: ServiceHandle<"service:local-city">): ServiceCall<LocalCityFix>;
  /**
   * 输入提示（`Autocomplete#search` + `onSearchComplete`）。
   *
   * **同一实例上同关键词的重叠请求会被拒绝**（`status: "failed"` + `BMAP_SERVICE_FAILED`）：
   * `Autocomplete` 的回包**不带请求身份**（只有可选的 `keyword`），两次同名请求的回包互相
   * 不可区分，猜归属会把旧结果当成新结果。等前一次结算（或改用不同关键词）即可正常调用；
   * 精确的并发隔离需要「每次请求一个独立实例」，属 M7（#38 / #41）的接口设计。
   */
  suggest(
    handle: ServiceHandle<"service:autocomplete">,
    keyword: string,
  ): ServiceCall<PlaceSuggestion[]>;
}

/** JSAPI 4.0 的 Service Facet：创建面 + 归一化调用面。 */
export interface JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver {}
