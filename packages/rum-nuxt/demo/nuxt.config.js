export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: false },
  css: ['~/assets/demo.css'],
  build: {
    transpile: [
      '@cloudcare/browser-core',
      '@cloudcare/browser-rum',
      '@cloudcare/browser-rum-nuxt'
    ]
  }
})
