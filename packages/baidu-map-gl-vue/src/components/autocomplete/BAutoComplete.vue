<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, shallowRef, markRaw } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { MapReadyContext } from "../../core/context/types";

/**
 * M4-09: BAutoComplete 迁移
 *
 * Autocomplete 需要绑定真实 input DOM(not overlay/control)。
 * 使用 map context + ready 后创建 SDK 实例,并把 input 传给 SDK。
 */

export interface BAutoCompleteProps {
  location?: string | { lng: number; lat: number } | unknown;
  types?: string[];
  onSearchComplete?: (e: unknown) => void;
  onHighlight?: (e: unknown) => void;
  onConfirm?: (e: unknown) => void;
}

const props = withDefaults(defineProps<BAutoCompleteProps>(), {});

const emit = defineEmits<{
  searchComplete: [e: unknown];
  highlight: [e: unknown];
  confirm: [e: unknown];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

type SdkAutocomplete = {
  setLocation(loc: unknown): void;
  setTypes(types: string[]): void;
  addEventListener?(name: string, h: (e: unknown) => void): void;
  removeEventListener?(name: string, h: (e: unknown) => void): void;
};

function resolveLocation(api: unknown, location: unknown, map: unknown): unknown {
  if (
    location &&
    typeof location === "object" &&
    (location as { lng?: unknown }).lng !== undefined &&
    (location as { lat?: unknown }).lat !== undefined
  ) {
    const Point = (api as { Point: new (l: number, t: number) => unknown }).Point;
    const loc = location as { lng: number; lat: number };
    return new Point(loc.lng, loc.lat);
  }
  return location ?? map;
}

const resource = shallowRef<SdkAutocomplete | null>(null);
const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let readyCtx: MapReadyContext | null = null;
let disposed = false;

onMounted(async () => {
  try {
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed || disposed) return;
    readyCtx = ready;
    const BMapGL = ready.api as { Autocomplete: new (o: Record<string, unknown>) => unknown };
    const input = inputRef.value;
    if (!input) return;
    const instance = new BMapGL.Autocomplete({
      location: resolveLocation(ready.api, props.location, ready.map),
      input,
      types: props.types,
      onSearchComplete: (e: unknown) => emit("searchComplete", e),
    }) as unknown as SdkAutocomplete;
    resource.value = markRaw(instance);
    // bind highlight / confirm
    const bind = (name: string, h: (e: unknown) => void) => {
      instance.addEventListener?.(name, h);
      scope.add(() => instance.removeEventListener?.(name, h));
    };
    bind("highlight", (e) => emit("highlight", e));
    bind("confirm", (e) => emit("confirm", e));

    watch(
      () => props.location,
      (loc) => {
        const inst = resource.value;
        if (inst) inst.setLocation(resolveLocation(ready.api, loc, ready.map));
      },
    );
    watch(
      () => props.types,
      (types) => {
        const inst = resource.value;
        if (inst && types) inst.setTypes(types);
      },
    );
    // 挂到 scope,卸载自动释放
    scope.add(() => {
      resource.value = null;
    });
  } catch (error) {
    if (!scope.signal.aborted && !disposed) {
      ctx.events.emit("resource:error", {
        error:
          error instanceof BMapError
            ? error
            : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
        component: "BAutoComplete",
      });
    }
  }
});

onUnmounted(() => {
  disposed = true;
  scope.dispose();
});

defineOptions({ name: "BAutoComplete" });
</script>

<template>
  <input class="b-auto-complete-input" type="text" ref="inputRef" placeholder="请输入搜索关键词" />
</template>
