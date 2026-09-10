/**
 * TargetContext
 *
 * 嵌套挂载目标的响应式表达:子资源应该挂到 Map/Marker/Clusterer/Overlay/Layer。
 * shallowRef 天然支持父资源稍晚就绪,子组件 watch target 即可原子挂载。
 */
import {
  computed,
  inject,
  readonly,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from "vue";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";
import type { MapContext } from "./types";
import { useRequiredMapContext } from "./inject";
import { overlayContextKey } from "./types";

export type TargetKind = "map" | "marker" | "overlay" | "clusterer" | "layer";

export interface TargetContext {
  readonly kind: Readonly<ShallowRef<TargetKind>>;
  readonly target: Readonly<ShallowRef<SdkHandle<string> | null>>;
  add(resource: OverlayHandle): void;
  remove(resource: OverlayHandle): void;
}

export const targetContextKey: InjectionKey<TargetContext> = Symbol(
  "bmap-target-context",
);

function noop(): void {}

export function createStaticTarget(
  kind: TargetKind,
  target: ShallowRef<SdkHandle<string> | null>,
  add: TargetContext["add"] = noop,
  remove: TargetContext["remove"] = noop,
): TargetContext {
  const kindRef = shallowRef<TargetKind>(kind);
  return {
    kind: readonly(kindRef),
    target: readonly(target),
    add,
    remove,
  };
}

/**
 * 解析当前挂载目标:最近 TargetContext > 回退 Map。
 * 默认 Map Target 的 target 随 MapHandle 就绪自动更新。
 */
export function useResolvedTarget(
  mapContext?: MapContext,
): Readonly<ShallowRef<TargetContext>> {
  const mapCtx = mapContext ?? useRequiredMapContext();
  const injected = inject(targetContextKey, undefined);
  if (injected) {
    // 注意:不得用 readonly() 包裹 TargetContext 对象本身——reactive/readonly
    // 代理会解包对象内的 ref,破坏 kind/target 的 Ref 语义。内层 ref 已各自
    // readonly,外层 holder 保持 plain shallowRef 即可。
    const holder = shallowRef(injected);
    return holder as Readonly<ShallowRef<TargetContext>>;
  }
  // 默认 Map Target:computed 随 handle 就绪更新
  const kindRef = shallowRef<TargetKind>("map");
  const targetRef = computed(
    () => (mapCtx.map.value as unknown as SdkHandle<string> | null) ?? null,
  );
  const mapTarget: TargetContext = {
    kind: readonly(kindRef),
    target: targetRef,
    add: (resource) => {
      const map = mapCtx.map.value;
      const client = mapCtx.client.value;
      if (!map || !client) return;
      client.driver.overlays.add({ kind: "map", handle: map }, resource);
    },
    remove: (resource) => {
      const map = mapCtx.map.value;
      const client = mapCtx.client.value;
      if (!map || !client) return;
      try {
        client.driver.overlays.remove({ kind: "map", handle: map }, resource);
      } catch {
        /* 忽略 teardown 竞态 */
      }
    },
  };
  return shallowRef(mapTarget) as Readonly<ShallowRef<TargetContext>>;
}

export function useOptionalTargetContext(): TargetContext | undefined {
  return inject(targetContextKey, undefined);
}

/**
 * 兼容读取:优先新 TargetContext,其次旧 overlayContextKey(函数式)。
 * 用于 BContextMenu 等需要响应父 Marker 晚就绪的场景。
 */
export function useParentOverlayHandle(): ShallowRef<SdkHandle<string> | null> {
  const targetCtx = inject(targetContextKey, undefined);
  const legacy = inject(overlayContextKey, null) as
    | (() => unknown)
    | ShallowRef<unknown>
    | null;
  const out = shallowRef<SdkHandle<string> | null>(
    (targetCtx?.target.value as SdkHandle<string> | null) ?? null,
  );
  if (targetCtx) {
    watch(
      () => targetCtx.target.value,
      (v) => {
        out.value = (v as SdkHandle<string> | null) ?? null;
      },
      { immediate: true, flush: "sync" },
    );
    return readonly(out) as ShallowRef<SdkHandle<string> | null>;
  }
  if (typeof legacy === "function") {
    watch(
      () => (legacy() as SdkHandle<string> | null) ?? null,
      (v) => {
        out.value = v;
      },
      { immediate: true, flush: "sync" },
    );
  } else if (legacy && typeof legacy === "object" && "value" in legacy) {
    watch(
      () => ((legacy as ShallowRef<unknown>).value as SdkHandle<string> | null) ?? null,
      (v) => {
        out.value = v;
      },
      { immediate: true, flush: "sync" },
    );
  }
  return readonly(out) as ShallowRef<SdkHandle<string> | null>;
}
