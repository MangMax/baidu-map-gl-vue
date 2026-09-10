/// <reference types="@baidumap/jsapi-v4-types" />

/**
 * JSAPI 4.0 官方类型接入边界（M3A.0 / issue #14）
 *
 * 约定：
 * 1. 本仓库只通过 `v=4.0` 加载器得到全局 `BMap` 命名空间，不具名导入
 *    `@baidumap/jsapi-v4-types`（该包是纯 `.d.ts`，没有运行时导出）。
 * 2. `BMap.*` 类型只允许出现在 v4 Driver/Provider、Fake SDK、本文件与最小
 *    augmentation；组件、composable、runtime 只能依赖项目领域类型与 Facet
 *    Driver 契约。
 * 3. 官方类型未覆盖的运行时成员，集中在本目录做最小 augmentation，升级类型
 *    包后重新核对并删除已被官方覆盖的声明；禁止 `any` 或复制整套声明。
 * 4. 类型包只参与类型检查与声明生成，不进入运行时 bundle，也不是运行时依赖。
 *
 * 版本锁定：`@baidumap/jsapi-v4-types` 以精确版本声明在
 * `packages/baidu-map-gl-vue/package.json`，并在
 * `packages/baidu-map-gl-vue/tsconfig.build.json` 的 `compilerOptions.types`
 * 中显式接入。升级类型包后需重新验证 `skipLibCheck: false`。
 */

/**
 * 以下为官方 `4.0.4` 声明缺口的最小补丁：这些名字在官方包内被引用，但尚未
 * 声明。升级 `@baidumap/jsapi-v4-types` 后必须重新核对，官方补齐即删除。
 */
declare namespace BMap {
  /** 自定义地图类型选项（官方 `MapType` 构造参数引用，暂缺声明） */
  interface MapTypeOptions {
    minZoom?: number;
    maxZoom?: number;
    textColor?: string;
    tips?: string;
  }

  /** 地图投影（官方 `MapType#getProjection` 返回，暂缺声明） */
  interface Projection {}

  /** 路径服务 polyline 样式（官方 `Route#setPolylineStyle` 参数引用，暂缺声明） */
  interface RoutePolylineStyle {
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
    highlight?: {
      strokeColor?: string;
      strokeWeight?: number;
      strokeOpacity?: number;
    };
  }
}
