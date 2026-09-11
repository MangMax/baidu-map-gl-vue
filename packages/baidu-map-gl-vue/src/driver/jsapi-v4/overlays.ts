/**
 * v4 OverlayDriver（M3A2-OVERLAYS / issue #21）
 *
 * 把 JSAPI 4.0 的覆盖物收敛成项目领域映射（`OverlayDriver`）；公共 API 只新增
 * 「Rectangle / CustomOverlay 两个构造入口」与「属性分类查询 `updatePolicy`」。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - 覆盖物统一经 `map.addOverlay/removeOverlay` 管理，显隐是继承来的 `show/hide/isVisible`；
 * - `InfoWindow` **不是**普通 Overlay：`map.openInfoWindow(infoWnd, point)` 必须带位置，
 *   关闭是地图级的 `map.closeInfoWindow()`（无参数），状态查询走公开的 `isOpen()` /
 *   `map.getInfoWindow()`——不用任何私有字段；
 * - `Rectangle` 收 Bounds；`CustomOverlay` 由 DOM 工厂 + 构造选项创建，4.0 缺 point 直接拒绝，
 *   因此项目签名把位置提为必填位置参数；
 * - `ContextMenu` 经 `map.addContextMenu/removeContextMenu` 挂在 Map 上（4.0 没有 Marker 级挂载）；
 * - `Marker3D` / `MapMask` 在 4.0.4 类型包与官方参考里都**没有声明**，只能按命名空间结构性探测：
 *   有就按结构创建，没有就显式失败（不是静默降级）。
 *
 * 属性更新一律走 `driver/types/overlays.ts` 的 `OVERLAY_DESCRIPTORS`：`mutable` 调字段级 setter /
 * 成对开关；`recreate` 与 `unsupported` **不静默**——前者告警一次并把决定权交给调用方（组件侧
 * `useOverlayResource.applyOptions` 据此重建一次），后者告警一次说明本引擎没有该语义。
 * 组件因此不再需要探测 `raw.setIcon` 之类的成员形状。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import type { CapabilityRegistry } from "../capability/registry";
import type { Bounds, GeometryDriver, Pixel, Point } from "../types/geometry";
import type {
  InfoWindowHandle,
  MapHandle,
  MarkerHandle,
  OverlayHandle,
  SdkHandle,
} from "../types/handles";
import type {
  CustomOverlayOptions,
  InfoWindowOptions,
  LabelOptions,
  MarkerIconInput,
  MarkerOptions,
  OverlayDescriptor,
  OverlayDriver,
  OverlayKind,
  OverlayPropertySpec,
  OverlayTarget,
  PathOptions,
} from "../types/overlays";
import {
  OVERLAY_DESCRIPTORS,
  mutableSetter,
  mutableToggle,
  overlayDescriptor,
  overlayKindOf,
  overlayPropertyPolicy,
  overlayPropertySetter,
  overlayPropertySpec,
} from "../types/overlays";
import {
  assertJsapiV4Namespace,
  callOptional,
  callRequired,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 内置图标名的雪碧图映射（与 `webgl-v1/overlays.ts` 刻意保持两份）。
 *
 * 4.0 的正式图标入口是 `BMap.Icon` / `BMap.Symbol` / `BMap.Icons`，但 `Icons` 不在 4.0.4
 * 类型包里、也没有官方参考章节可核对，因此这里沿用**库已有的内置图标语义**（同名同图同偏移），
 * 保证 `<BMarker icon="simple_red">` 换引擎后观感一致。跨引擎重复会在 #26 删除 `webgl-v1` 时
 * 自然收敛（同 ADR 2026-09-11-jsapi-v4-map-facet 的交互映射表）。
 */
const DEFAULT_ICON_URL =
  "https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";

const ICON_OFFSETS: Record<string, [number, number, number, number]> = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
};

const SPECIAL_ICON_URLS: Record<string, string> = {
  start:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%231677ff' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
  end: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%23f04444' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
};

export interface CreateJsapiV4OverlayDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4OverlayDriver(
  input: CreateJsapiV4OverlayDriverInput,
): OverlayDriver {
  const { rawSdk, geometry, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /** 已告警过的「分类 / 键 / 种类」组合：每个 Driver 一份，避免重复刷屏。 */
  const warned = new Set<string>();
  /** `openInfoWindow` 打开过的气泡 → 它所属的 raw map（**归属**记账，不是打开状态）。 */
  const infoWindowOwners = new WeakMap<object, object>();
  /** `createContextMenu({ width })` → `MenuItem` 的默认宽度。 */
  const menuWidths = new WeakMap<object, number>();

  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(message);
  };

  /** 句柄种类：只读品牌即可（纯元数据），真正的所有权校验留给 `registry.resolve`。 */
  const kindOfHandle = (overlay: OverlayHandle): OverlayKind => {
    const kind = overlayKindOf(overlay);
    if (!kind) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        "覆盖物句柄种类无法识别：句柄必须由本 Driver 创建（raw SDK 对象请先经 SDK 边界包装）",
        { engine: "jsapi-v4" },
      );
    }
    return kind;
  };

  /** 属性元数据查询走公共描述符（`driver/types/overlays.ts`），Driver 不另抄一份键表。 */
  const specOf = (descriptor: OverlayDescriptor, key: string): OverlayPropertySpec | undefined =>
    overlayPropertySpec(descriptor.kind, key);

  const rawSize = (pixel: Pixel): unknown =>
    geometry.toRawSize({ width: pixel.x, height: pixel.y });

  const buildIcon = (icon: MarkerIconInput): unknown => {
    const Icon = namespaceCtor(namespace, "Icon");
    if (typeof icon === "string") {
      const special = SPECIAL_ICON_URLS[icon];
      if (special) {
        return new Icon(special, geometry.toRawSize({ width: 24, height: 32 }), {
          anchor: geometry.toRawSize({ width: 12, height: 16 }),
        });
      }
      const [ox, oy, w, h] = ICON_OFFSETS[icon] ?? [454, 378, 42, 66];
      return new Icon(DEFAULT_ICON_URL, geometry.toRawSize({ width: w / 2, height: h / 2 }), {
        imageOffset: geometry.toRawSize({ width: ox / 2, height: oy / 2 }),
        imageSize: geometry.toRawSize({ width: 300, height: 300 }),
      });
    }
    const opts: Record<string, unknown> = {};
    if (icon.imageSize) opts.imageSize = geometry.toRawSize(icon.imageSize);
    if (icon.anchor) opts.anchor = rawSize(icon.anchor);
    if (icon.imageOffset) opts.imageOffset = rawSize(icon.imageOffset);
    if (icon.printImageUrl) {
      // 4.0.4 的 IconOptions 只声明 anchor / imageOffset / imageSize，没有打印图入口
      warnOnce(
        "icon:print-image-url",
        "OverlayDriver.buildIcon: MarkerIconInput.printImageUrl 在 JSAPI 4.0 的 IconOptions 里没有对应项（4.0.4 只声明 anchor / imageOffset / imageSize），已丢弃",
      );
    }
    return new Icon(icon.imageUrl, geometry.toRawSize(icon.size), opts);
  };

  /** 领域值 → v4 构造参数 / setter 入参。 */
  const normalize = (spec: OverlayPropertySpec, value: unknown): unknown => {
    switch (spec.value) {
      case "point":
        return geometry.toRawPoint(value as Point);
      case "points":
        return geometry.toRawPoints(value as readonly Point[]);
      case "path":
        // 允许 SDK 原生字符串路径（行政区边界名），与 setPath 的口径保持一致
        return toRawPath(value as readonly (Point | string)[]);
      case "point-groups":
        return (value as readonly (readonly Point[])[]).map((group) =>
          geometry.toRawPoints(group),
        );
      case "bounds":
        return geometry.toRawBounds(value as Bounds);
      case "size":
        // 项目侧偏移是 Pixel（`{x, y}`），v4 的 offset / anchor 是 Size（`{width, height}`）
        return rawSize(value as Pixel);
      case "icon":
        return buildIcon(value as MarkerIconInput);
      default:
        return value;
    }
  };

  /**
   * 领域 options → v4 构造 options。
   *
   * - 描述符里**有 ctorKey** 的键：改写成 v4 的键名并按 `value` 归一化（`recreate` 分类的键也
   *   属于构造期属性，因此同样投影）；
   * - 描述符里 `ctorKey === null` 的键：是位置参数，已在各 `create*` 里显式传入，这里剔除，
   *   避免同一个值既走位置参数又进 options；
   * - 描述符**没有**的键：原样透传（项目 option 接口的索引签名就是 v4 自身构造选项的逃生口，
   *   例如 GroundOverlay 的 `type`、Prism 的 `autoCenter`）；
   * - `unsupported` 分类的键：显式告警（本引擎没有该语义），不透传也不静默。
   */
  const projectOptions = (
    descriptor: OverlayDescriptor,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      const spec = specOf(descriptor, key);
      if (!spec) {
        projected[key] = value;
        continue;
      }
      if (spec.policy === "unsupported") {
        warnOnce(
          `${descriptor.kind}:ctor:${key}`,
          `OverlayDriver: ${descriptor.kind}.${key} 在 JSAPI 4.0 不支持（${spec.reason}），构造时已忽略`,
        );
        continue;
      }
      if (spec.ctorKey == null) continue;
      projected[spec.ctorKey] = normalize(spec, value);
    }
    return projected;
  };

  /** 采纳 raw 对象为句柄：先按能力策略守卫，再登记（品牌 = `overlay:<kind>`）。 */
  const adopt = <Kind extends OverlayKind>(
    kind: Kind,
    raw: unknown,
  ): SdkHandle<`overlay:${Kind}`> => {
    const descriptor = overlayDescriptor(kind);
    if (descriptor.capability) capabilities.require(descriptor.capability);
    return registry.adopt(`overlay:${kind}`, raw);
  };

  const ctorFor = (kind: OverlayKind): JsapiV4Ctor =>
    namespaceCtor(namespace, overlayDescriptor(kind).ctor);

  const toRawPath = (path: readonly (Point | string)[]): unknown[] =>
    path.map((point) => (typeof point === "string" ? point : geometry.toRawPoint(point)));

  /** 覆盖物只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const requireMapTarget = (target: OverlayTarget, operation: string): object => {
    if (target.kind !== "map") {
      warnOnce(
        `target:${target.kind}`,
        `OverlayDriver.${operation}: JSAPI 4.0 的覆盖物只能挂到 Map（map.addOverlay / removeOverlay）；` +
          `目标 kind="${target.kind}" 没有运行时入口（BMapGL 的 Marker / Clusterer 级挂载属迁移期能力），本次调用被拒绝`,
      );
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `OverlayDriver.${operation}: target.kind="${target.kind}" 在 JSAPI 4.0 没有运行时入口`,
        { engine: "jsapi-v4" },
      );
    }
    return registry.resolve<object>(target.handle);
  };

  const assertNotInfoWindow = (kind: OverlayKind, operation: string): void => {
    if (kind !== "info-window") return;
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `OverlayDriver.${operation}: InfoWindow 不作为普通覆盖物处理——打开/关闭是地图级 API，` +
        "请用 openInfoWindow(map, infoWindow, position) / closeInfoWindow(infoWindow)",
      { engine: "jsapi-v4" },
    );
  };

  /**
   * 结构性查找「官方类型包没有声明」的运行时扩展构造器。
   *
   * 不预判版本、也不臆造 augmentation：有就按结构创建，没有就显式失败并点名缺的是哪个构造器
   * （与 ADR 2026-09-11-jsapi-v4-map-facet 对 `tilt-gestures` 的处理同源）。
   *
   * 真实 AK smoke（ADR「真实 AK smoke 记录」一节）确认：`Marker3D` / `MapMask` 在 4.0 运行时
   * **都存在**，只是 `@baidumap/jsapi-v4-types@4.0.4` 没有类声明——所以这条路在真实 SDK 上会
   * 直接创建成功；失败分支只在「运行时确实没提供」时触发（Fake v4 故意不提供，用来覆盖它）。
   */
  const requireRuntimeCtor = (kind: OverlayKind, hint: string): JsapiV4Ctor => {
    const name = overlayDescriptor(kind).ctor;
    const ctor = readNamespaceMember(namespace, name);
    if (typeof ctor === "function") return ctor as JsapiV4Ctor;
    warnOnce(
      `${kind}:no-runtime-entry`,
      `OverlayDriver: 当前 SDK 运行时没有提供 ${name}（官方 4.0.4 类型包也没有它的类声明，` +
        `官方参考 references/* 无对应章节）；"${kind}" 无法创建；${hint}`,
    );
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `BMap.${name} is not available（当前运行时没有提供 "${kind}" 的构造器）`,
      { engine: "jsapi-v4" },
    );
  };

  return {
    createMarker(position, options: MarkerOptions = {}): MarkerHandle {
      const opts = projectOptions(overlayDescriptor("marker"), options);
      const raw = sdkCall(
        "Marker",
        () => new (ctorFor("marker"))(geometry.toRawPoint(position), opts),
      );
      return adopt("marker", raw);
    },

    createPolyline(path, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("polyline"), options);
      const raw = sdkCall(
        "Polyline",
        () => new (ctorFor("polyline"))(geometry.toRawPoints(path), opts),
      );
      return adopt("polyline", raw);
    },

    createPolygon(path, options: PathOptions & { isBoundary?: boolean } = {}) {
      const opts = projectOptions(overlayDescriptor("polygon"), options);
      const raw = sdkCall("Polygon", () => new (ctorFor("polygon"))(toRawPath(path), opts));
      return adopt("polygon", raw);
    },

    createRectangle(bounds, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("rectangle"), options);
      const raw = sdkCall(
        "Rectangle",
        () => new (ctorFor("rectangle"))(geometry.toRawBounds(bounds), opts),
      );
      return adopt("rectangle", raw);
    },

    createCircle(center, radius, options: PathOptions = {}) {
      const opts = projectOptions(overlayDescriptor("circle"), options);
      const raw = sdkCall(
        "Circle",
        () => new (ctorFor("circle"))(geometry.toRawPoint(center), radius, opts),
      );
      return adopt("circle", raw);
    },

    createInfoWindow(content, options: InfoWindowOptions = {}): InfoWindowHandle {
      const opts = projectOptions(overlayDescriptor("info-window"), options);
      const raw = sdkCall("InfoWindow", () => new (ctorFor("info-window"))(content, opts));
      return adopt("info-window", raw);
    },

    createLabel(content, options: LabelOptions = {}) {
      const opts = projectOptions(overlayDescriptor("label"), options);
      const raw = sdkCall("Label", () => new (ctorFor("label"))(content, opts));
      return adopt("label", raw);
    },

    createPrism(path, altitude, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("prism"), options);
      const raw = sdkCall("Prism", () => new (ctorFor("prism"))(toRawPath(path), altitude, opts));
      return adopt("prism", raw);
    },

    createMarker3D(position, height, options: Record<string, unknown> = {}) {
      // `Marker3D` 在类型包里只出现在 const/Marker3DShapeType.d.ts 的文档注释里（没有类声明），
      // 但真实 4.0 运行时确实提供该构造器 → 按结构创建；缺成员时才显式失败。
      const Ctor = requireRuntimeCtor(
        "marker3d",
        "需要 3D 标记时可改用 Marker + 自定义 icon",
      );
      const opts = projectOptions(overlayDescriptor("marker3d"), options);
      const raw = sdkCall("Marker3D", () => new Ctor(geometry.toRawPoint(position), height, opts));
      return adopt("marker3d", raw);
    },

    createBezierCurve(path, controlPoints, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("bezier-curve"), options);
      const raw = sdkCall(
        "BezierCurve",
        () =>
          new (ctorFor("bezier-curve"))(
            geometry.toRawPoints(path),
            controlPoints.map((group) => geometry.toRawPoints(group)),
            opts,
          ),
      );
      return adopt("bezier-curve", raw);
    },

    createMapMask(path, options: Record<string, unknown> = {}) {
      // 同 `createMarker3D`：类型包无类声明，但真实 4.0 运行时提供 `MapMask`。
      const Ctor = requireRuntimeCtor("map-mask", "本仓库的 <BMapMask> 需要该构造器");
      const opts = projectOptions(overlayDescriptor("map-mask"), options);
      const raw = sdkCall("MapMask", () => new Ctor(geometry.toRawPoints(path), opts));
      return adopt("map-mask", raw);
    },

    createGroundOverlay(bounds, options: Record<string, unknown> = {}) {
      const opts = projectOptions(overlayDescriptor("ground-overlay"), options);
      const raw = sdkCall(
        "GroundOverlay",
        () => new (ctorFor("ground-overlay"))(geometry.toRawBounds(bounds), opts),
      );
      return adopt("ground-overlay", raw);
    },

    createCustomOverlay(position, render, options: CustomOverlayOptions = {}) {
      // anchor（元组）与 offset（拆成 offsetX/offsetY）先摘出来，再走统一的构造选项投影
      const { anchor, offset, ...rest } = options;
      const opts = projectOptions(overlayDescriptor("custom-overlay"), rest);
      opts.point = geometry.toRawPoint(position);
      if (anchor) opts.anchors = [anchor.x, anchor.y];
      if (offset) {
        opts.offsetX = offset.x;
        opts.offsetY = offset.y;
      }
      const raw = sdkCall("CustomOverlay", () => new (ctorFor("custom-overlay"))(render, opts));
      return adopt("custom-overlay", raw);
    },

    createContextMenu(options) {
      const raw = sdkCall("ContextMenu", () => new (ctorFor("context-menu"))());
      // ContextMenu 自身没有宽度；宽度是 MenuItem 的构造选项，因此记成默认值
      if (options?.width != null) menuWidths.set(raw as object, options.width);
      return adopt("context-menu", raw);
    },

    addContextMenuItem(menu, item, options) {
      const raw = registry.resolve<object>(menu);
      if (item === "-") {
        sdkCall("ContextMenu.addSeparator", () => callRequired(raw, "addSeparator"));
        return;
      }
      const width = options?.width ?? menuWidths.get(raw);
      const MenuItem = namespaceCtor(namespace, "MenuItem");
      const menuItem = sdkCall(
        "MenuItem",
        () => new MenuItem(item.text, item.callback, width != null ? { width } : {}),
      );
      if (item.disabled) callOptional(menuItem, "disable");
      sdkCall("ContextMenu.addItem", () => callRequired(raw, "addItem", menuItem));
    },

    add(target, overlay) {
      const kind = kindOfHandle(overlay);
      assertNotInfoWindow(kind, "add");
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(overlay);
      sdkCall("map.addOverlay", () => callRequired(rawMap, "addOverlay", raw));
    },

    remove(target, overlay) {
      const kind = kindOfHandle(overlay);
      assertNotInfoWindow(kind, "remove");
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(overlay);
      sdkCall("map.removeOverlay", () => callRequired(rawMap, "removeOverlay", raw));
    },

    show(overlay) {
      const raw = registry.resolve<object>(overlay);
      const fn = readNamespaceMember(raw, "show");
      if (typeof fn !== "function") return false;
      sdkCall("overlay.show", () => (fn as () => unknown).apply(raw));
      return true;
    },

    hide(overlay) {
      const raw = registry.resolve<object>(overlay);
      const fn = readNamespaceMember(raw, "hide");
      if (typeof fn !== "function") return false;
      sdkCall("overlay.hide", () => (fn as () => unknown).apply(raw));
      return true;
    },

    attachContextMenu(target, menu) {
      const rawMap = requireMapTarget(target, "attachContextMenu");
      const raw = registry.resolve<object>(menu);
      sdkCall("map.addContextMenu", () => callRequired(rawMap, "addContextMenu", raw));
    },

    detachContextMenu(target, menu) {
      const rawMap = requireMapTarget(target, "detachContextMenu");
      const raw = registry.resolve<object>(menu);
      sdkCall("map.removeContextMenu", () => callRequired(rawMap, "removeContextMenu", raw));
    },

    setPosition(overlay, position) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      // setter 名一律取自描述符（单一事实源）；这里只保留两个真正的语义决定：
      // 1. 圆的位置属性叫 `center`（官方 setCenter），其余覆盖物叫 `position`；
      // 2. CustomOverlay 用 `setPoint(point, true)`：只位移、不重建 DOM —— 重建会丢掉业务 DOM
      //    上的 listener / timer / observer（官方要求业务先自行释放），而 setPosition 就是位移。
      const setter = overlayPropertySetter(kind, kind === "circle" ? "center" : "position");
      if (!setter) {
        throw new BMapError(
          "BMAP_CAPABILITY_UNSUPPORTED",
          `OverlayDriver.setPosition: ${kind} 没有位置类 setter（描述符里 center / position 都不是 mutable）`,
          { engine: "jsapi-v4" },
        );
      }
      const point = geometry.toRawPoint(position);
      const args = kind === "custom-overlay" ? [point, true] : [point];
      sdkCall(setter, () => callRequired(raw, setter, ...args));
    },

    setPath(overlay, path) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      const setter = overlayPropertySetter(kind, "path") ?? "setPath";
      sdkCall(setter, () => callRequired(raw, setter, toRawPath(path)));
    },

    setOptions(overlay, options) {
      const kind = kindOfHandle(overlay);
      const raw = registry.resolve<Record<string, unknown>>(overlay);
      const descriptor = overlayDescriptor(kind);
      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        const spec = specOf(descriptor, key);
        if (!spec) {
          // 逃生口：未知键按 `set<Key>` 结构性调用（与 webgl-v1 的默认分支同形）
          const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          const fn = readNamespaceMember(raw, setter);
          if (typeof fn === "function") {
            sdkCall(setter, () => (fn as (v: unknown) => unknown).apply(raw, [value]));
          } else {
            warnOnce(
              `${kind}:unknown:${key}`,
              `OverlayDriver.setOptions: ${kind} 没有 "${key}" 的字段级 setter（也不在覆盖物属性描述符里），本次更新被忽略`,
            );
          }
          continue;
        }
        if (spec.policy === "mutable") {
          // 分类是**声明**层（描述符按官方类型给出）；实例上缺成员属于声明与运行时的偏差，
          // 必须告警一次而不是静默 no-op（否则组件会以为「更新成功了」）。
          const setter = mutableSetter(spec);
          const toggle = mutableToggle(spec);
          const method = setter ?? (value ? toggle![0] : toggle![1]);
          if (typeof readNamespaceMember(raw, method) !== "function") {
            warnOnce(
              `${kind}:missing:${method}`,
              `OverlayDriver.setOptions: ${kind}.${key} 声明为 mutable（${method}），但当前实例没有该方法，本次更新被忽略`,
            );
            continue;
          }
          const args = setter ? [normalize(spec, value)] : [];
          sdkCall(method, () => callOptional(raw, method, ...args));
          continue;
        }
        warnOnce(
          `${kind}:${spec.policy}:${key}`,
          spec.policy === "recreate"
            ? `OverlayDriver.setOptions: ${kind}.${key} 只有构造期生效（${spec.reason}）；` +
                "本次更新被忽略，需要生效请重建实例（可用 OverlayDriver.updatePolicy() 预判）"
            : `OverlayDriver.setOptions: ${kind}.${key} 在当前引擎不支持（${spec.reason}）；本次更新被忽略`,
        );
      }
    },

    updatePolicy(overlay, key) {
      // 纯元数据查询：不校验所有权（跨 Client 的句柄会在真正的操作路径上被拒绝）
      const kind = overlayKindOf(overlay);
      if (!kind) return undefined;
      return overlayPropertyPolicy(kind, key);
    },

    openInfoWindow(map: MapHandle, overlay, position) {
      const rawMap = registry.resolve<object>(map);
      const raw = registry.resolve<object>(overlay);
      if (position) {
        sdkCall("map.openInfoWindow", () =>
          callRequired(rawMap, "openInfoWindow", raw, geometry.toRawPoint(position)),
        );
      } else {
        // 官方 4.0 的 map.openInfoWindow(infoWnd, point) 要求位置；实例级 openInfoWindow()
        // 不在 4.0.4 声明里（运行时成员），只能结构性尝试并显式告警。
        const fn = readNamespaceMember(raw, "openInfoWindow");
        if (typeof fn !== "function") {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            "OverlayDriver.openInfoWindow: JSAPI 4.0 要求给出打开位置（map.openInfoWindow(infoWnd, point)），" +
              "且当前 InfoWindow 实例没有可用的运行时 openInfoWindow()",
            { engine: "jsapi-v4" },
          );
        }
        warnOnce(
          "info-window:open-without-position",
          "OverlayDriver.openInfoWindow: 未给出位置，回退到 InfoWindow 实例级 openInfoWindow()" +
            "（JSAPI 4.0.4 类型包未声明该成员，属运行时能力）；建议显式传入 position",
        );
        sdkCall("InfoWindow.openInfoWindow", () => (fn as () => unknown).apply(raw));
      }
      infoWindowOwners.set(raw, rawMap);
    },

    closeInfoWindow(overlay) {
      const raw = registry.resolve<object>(overlay);
      const owner = infoWindowOwners.get(raw);
      if (owner) {
        // 官方 map.closeInfoWindow() 没有参数，关的是「这张地图当前打开的气泡」；先用公开的
        // map.getInfoWindow() 确认不是**别的**气泡，避免关掉别的组件的窗口。
        //
        // 注意 `current` 为空**不能**当成「没打开」：真实 4.0 的打开是异步的（下一次绘制帧才
        // 生效），`openInfoWindow()` 之后同一 tick 里 `map.getInfoWindow()` 仍是 `null`
        // （真实 AK smoke 实测：0ms 为 null、~100ms 变成该实例）。所以只要**没有别的**气泡
        // 正开着，就照常调用 map.closeInfoWindow()；没有气泡时它是 no-op（同一 smoke 验证过
        // 重复 close 不抛错）。
        const current = callOptional(owner, "getInfoWindow");
        if (current && current !== raw) return;
        sdkCall("map.closeInfoWindow", () => callRequired(owner, "closeInfoWindow"));
        return;
      }
      // 从未由本 Driver 打开过：尝试实例级 close（真实 4.0 运行时提供 `InfoWindow#close`），
      // 没有则视为已关闭（幂等）
      const fn = readNamespaceMember(raw, "close");
      if (typeof fn === "function") {
        sdkCall("InfoWindow.close", () => (fn as () => unknown).apply(raw));
      }
    },

    redrawInfoWindow(overlay) {
      const raw = registry.resolve<object>(overlay);
      sdkCall("InfoWindow.redraw", () => callOptional(raw, "redraw"));
    },

    buildIcon,
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 覆盖物构造器名必须与官方 `BMap` 命名空间一致。
 *
 * `marker3d` / `map-mask` 被**显式排除**：它们的构造器在 `@baidumap/jsapi-v4-types@4.0.4`
 * 里不存在（官方参考也没有对应章节），属于运行时扩展，因此不能进「官方声明一致性」断言——
 * 它们的存在性只能由 `requireRuntimeCtor` 在运行时按结构判断。上游一旦补齐声明，这条断言会失败，
 * 提醒把结构性查找收回 `namespaceCtor`。
 */
type OfficialOverlayKind = Exclude<OverlayKind, "marker3d" | "map-mask">;
type OfficialOverlayCtor = (typeof OVERLAY_DESCRIPTORS)[OfficialOverlayKind]["ctor"];

// 断言结果不参与运行时；存在性由类型检查保证（`noUnusedLocals` 未开启）。
type _AssertOfficialOverlayCtors = ExpectTrue<
  OfficialOverlayCtor extends keyof typeof BMap ? true : false
>;
type _AssertIconAndMenuItem = ExpectTrue<
  ("Icon" | "MenuItem") extends keyof typeof BMap ? true : false
>;
