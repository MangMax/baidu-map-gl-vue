<template>
  <BMap v-bind="$attrs" @ready="handleInitd" :zoom="zoom">
    <BControl style="display: flex; background-color: #fff; padding: 10px" :offset="{ x: 0, y: 0 }">
      <button @click="handleZoomOut">缩小</button>
      <button @click="handleZoomIn">放大</button>
    </BControl>
  </BMap>
</template>

<script setup lang="ts">
import { ref } from "vue";
const zoom = ref(10);
let _map: { getZoom(): number } | null = null;
function handleInitd({ map }: { map: { getZoom(): number } }) {
  _map = map;
}
function handleZoomOut() {
  if (_map) zoom.value = _map.getZoom() - 1;
}
function handleZoomIn() {
  if (_map) zoom.value = _map.getZoom() + 1;
}
</script>

<style scoped>
button {
  outline: none;
  border: none;
  background: #41b883;
  margin: 0 5px;
  padding: 5px 15px;
  border-radius: 4px !important;
}
</style>
