<script setup lang="ts">
const props = defineProps({
  file: {
    type: String,
    required: true,
  },
  demo: {
    type: Object,
    required: true,
  },
  height: {
    type: Number,
    default: undefined,
  },
});
</script>

<template>
  <ClientOnly>
    <div
      class="example-showcase"
      :class="{ 'has-demo-height': props.height !== undefined }"
      :style="props.height !== undefined ? { '--demo-height': `${props.height}px` } : undefined"
    >
      <component :is="demo" v-if="demo" />
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
