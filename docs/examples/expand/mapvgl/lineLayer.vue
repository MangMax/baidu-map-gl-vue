<template>
  <BMap
    v-bind="$attrs"
    :zoom="15"
    :center="{ lat: 39.915185, lng: 116.403901 }"
    :displayOptions="{ indoor: false, poi: true }"
    enableScrollWheelZoom
    :plugins="['Mapvgl']"
    @pluginReady="handlePluginReady"
  />
</template>

<script setup>
function handlePluginReady(map) {
  const view = new mapvgl.View({ map });
  const lineLayer = new mapvgl.LineLayer({
    color: "rgba(50, 50, 200, 0.9)",
    blend: "lighter",
    width: 6,
    animation: true,
    interval: 0.15,
    duration: 2,
    trailLength: 0.5,
  });

  view.addLayer(lineLayer);
  lineLayer.setData([
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [116.394191, 39.91334],
          [116.403748, 39.915055],
          [116.417259, 39.913672],
        ],
      },
    },
  ]);
}
</script>
