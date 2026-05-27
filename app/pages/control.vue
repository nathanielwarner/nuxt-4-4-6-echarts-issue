<template>
  <div>
    <h1>Control page: option is JSON-safe (no function)</h1>
    <v-chart-full :option="option" :init-options="{ width: 400, height: 300 }" />
  </div>
</template>

<script setup>
// Same chart as index.vue, but tooltip.formatter is an ECharts string template
// instead of a JS function. The whole option is JSON-serializable, so the island
// prop hash survives the round-trip and the page prerenders cleanly.
const option = {
  tooltip: {
    trigger: 'axis',
    formatter: '{b}: {c}',
  },
  xAxis: { type: 'category', data: ['a', 'b', 'c'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [1, 2, 3] }],
};
</script>
