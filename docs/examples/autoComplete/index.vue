<template>
  <BMap :center="point || '北京市'">
    <BAutoComplete style="width: 100%" @confirm="handleConfirm" />
    <BMarker v-if="point" :position="point"></BMarker>
  </BMap>
</template>

<script setup lang="ts">
  import { BMap, BAutoComplete, BMarker, type PointLike, useBMapGeocoder } from 'baidu-map-gl-vue'
  const { get, point } = useBMapGeocoder()

  function handleConfirm(e: any) {
    const value = e.item.value as Record<string, string>
    get(value.province + value.city + value.district + value.street + value.business, value.city || value.business)
  }
</script>

<style scoped></style>
