// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  modules: ['nuxt-echarts'],
  echarts: {
    renderer: ['svg'],
    charts: ['BarChart'],
    components: ['TooltipComponent', 'GridComponent'],
  },
});
