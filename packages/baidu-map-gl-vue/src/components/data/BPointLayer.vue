<script setup lang="ts">
import BMarkerList from "./BMarkerList.vue";
import type { BMarkerListProps } from "./BMarkerList.vue";

/**
 * BPointLayer —— deprecated alias of BMarkerList.
 *
 * 名称暗示批量层，但实际每个 item 一个 SDK Marker（适合中小规模）。
 * 真实批量层完成前，实际实现名为 BMarkerList；BPointLayer 仅作兼容别名保留。
 * BPointCollection（单个批量 SDK 资源，适合大规模散点）规划中。
 *
 * @deprecated Use BMarkerList instead.
 */
export type BPointLayerProps<Item> = BMarkerListProps<Item>;

defineOptions({ name: "BPointLayer" });

const props = defineProps<BMarkerListProps<any>>();
const emit = defineEmits<{
  "item-click": [item: unknown];
}>();
</script>

<template>
  <BMarkerList
    :data="props.data"
    :item-key="props.itemKey as any"
    :get-position="props.getPosition"
    :data-version="props.dataVersion"
    :visible="props.visible"
    @item-click="(item) => emit('item-click', item)"
  >
    <slot />
  </BMarkerList>
</template>
