<script setup lang="ts">
import type { Component } from "vue";

withDefaults(
  defineProps<{
    file: string;
    demo?: Component;
    height?: number;
  }>(),
  { demo: undefined, height: undefined },
);
</script>

<template>
  <ClientOnly>
    <div
      class="example-showcase"
      :class="{ 'has-demo-height': height !== undefined }"
      :style="height !== undefined ? { '--demo-height': `${height}px` } : undefined"
    >
      <component :is="demo" v-if="demo" />
      <div v-else class="example-empty" role="status">示例加载失败：{{ file }}</div>
    </div>
  </ClientOnly>
</template>

<style lang="less" scoped>
.example-showcase {
  padding: 0 1rem;
  margin: 0.5px;
}
.example-showcase.has-demo-height > :deep(.bmap-container) {
  height: var(--demo-height) !important;
}
</style>
