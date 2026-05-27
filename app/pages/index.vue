<template>
  <div>
    <h1>Failing page: option contains a function</h1>
    <v-chart-full :option="option" :init-options="{ width: 400, height: 300 }" />
  </div>
</template>

<script setup>
// `tooltip.formatter` is a JS function. On Nuxt 4.4.6 the function is part of the
// island prop hashed on the client, but it is dropped by JSON serialization before
// the server re-validates the hash -> 400 Invalid island request hash.
const option = {
  tooltip: {
    trigger: 'axis',
    formatter: (params) => `value: ${params[0].data}`,
  },
  xAxis: { type: 'category', data: ['a', 'b', 'c'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [1, 2, 3] }],
};
</script>
