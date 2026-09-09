<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, shallowRef, markRaw } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { MapReadyContext } from "../../core/context/types";
import type { ServiceHandle } from "../../driver/types/handles";

/**
 * BAutoComplete 迁移
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

const resource = shallowRef<ServiceHandle<"service:autocomplete"> | null>(null);
const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let readyCtx: MapReadyContext | null = null;
let disposed = false;

function resolveLocation(client: MapReadyContext["client"], location: unknown): unknown {
  if (
    location &&
    typeof location === "object" &&
    (location as { lng?: unknown }).lng !== undefined &&
    (location as { lat?: unknown }).lat !== undefined
  ) {
    return client.driver.geometry.toRawPoint(location as { lng: number; lat: number });
  }
  return location;
}

onMounted(async () => {
  try {
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed || disposed) return;
    readyCtx = ready;
    const input = inputRef.value;
    if (!input) return;
    const instance = ready.client.driver.services.createAutocomplete({
      location: resolveLocation(ready.client, props.location ?? ready.map),
      input,
      types: props.types,
      onSearchComplete: (e: unknown) => emit("searchComplete", e),
    });
    resource.value = markRaw(instance as object) as ServiceHandle<"service:autocomplete">;
    // bind highlight / confirm
    scope.add(ready.client.driver.events.on(instance, "highlight", (e) => emit("highlight", e)));
    scope.add(ready.client.driver.events.on(instance, "confirm", (e) => emit("confirm", e)));

    watch(
      () => props.location,
      (loc) => {
        const inst = resource.value;
        if (inst && readyCtx) {
          const raw = inst.raw as { setLocation?: (loc: unknown) => void };
          raw.setLocation?.(resolveLocation(ready.client, loc));
        }
      },
    );
    watch(
      () => props.types,
      (types) => {
        const inst = resource.value;
        if (inst && types) {
          const raw = inst.raw as { setTypes?: (types: string[]) => void };
          raw.setTypes?.(types);
        }
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

<style scoped>
.b-auto-complete-input {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 10;
  box-sizing: border-box;
  width: 100%;
  max-width: calc(100% - 20px);
  padding: 6px 10px;
  color: #333;
  background-color: #fff;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  outline: none;
}

.b-auto-complete-input:focus {
  border-color: #1677ff;
}
</style>
