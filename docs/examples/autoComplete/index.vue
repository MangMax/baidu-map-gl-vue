<template>
  <BMap :center="point || '北京市'">
    <BAutoComplete style="width: 100%" @confirm="handleConfirm" />
    <BMarker v-if="point" :position="point"></BMarker>
  </BMap>
</template>

<script setup lang="ts">
  import { BMap, BAutoComplete, BMarker, type Point, useBMapGeocoder } from 'baidu-map-gl-vue'
  const { get, point } = useBMapGeocoder<Point>()

  function handleConfirm(e) {
    const value = e.item.value
    get(value.province + value.city + value.district + value.street + value.business, value.city || value.business)
  }
</script>

<style scoped></style>
