<template>
  <div>
    <BMap
      v-bind="$attrs"
      :center="{
        lng: 116.308301,
        lat: 40.050566
      }"
      :zoom="16"
      :plugins="['TrackAnimation']"
      ref="map"
      @ready="handleInitd"
    />
    <div class="state">
      <span v-if="error">错误 - {{ error }}</span>
      <span>动画状态: {{ status !== 'idle' ? '已开始' : '未开始' }}</span>
      <span>播放状态: {{ status === 'idle' || status === 'stopped' ? '未播放' : '播放中' }}</span>
    </div>
    <button class="myButton no-m-b" type="button" @click="handleStart">开始</button>
    <button class="myButton no-m-b" type="button" @click="pause">暂停</button>
    <button class="myButton no-m-b" type="button" @click="proceed">继续</button>
    <button class="myButton no-m-b" type="button" @click="cancel">取消</button>
  </div>
</template>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useBMapTrackAnimation } from 'baidu-map-gl-vue'
  const map = ref(null)
  const { setPath, start, pause, cancel, proceed, status } = useBMapTrackAnimation({
    duration: 10000,
    delay: 0
  }, map)
  const error = ref('')
  const path = [
    {
      lng: 116.297611,
      lat: 40.047363
    },
    {
      lng: 116.302839,
      lat: 40.048219
    },
    {
      lng: 116.308301,
      lat: 40.050566
    },
    {
      lng: 116.305732,
      lat: 40.054957
    },
    {
      lng: 116.304754,
      lat: 40.057953
    },
    {
      lng: 116.306487,
      lat: 40.058312
    },
    {
      lng: 116.307223,
      lat: 40.056379
    }
  ]
  async function handleInitd() {
    await setPath(path)
  }
  async function handleStart() {
    try {
      await start()
    } catch (err) {
      error.value = String(err)
    }
  }
</script>

<style>
  .state {
    margin-top: 15px;
  }
  .state span {
    margin-right: 25px;
  }
</style>
