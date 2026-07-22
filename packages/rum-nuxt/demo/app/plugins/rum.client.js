import { datafluxRum } from '@cloudcare/browser-rum'
import { nuxtRumPlugin } from '@cloudcare/browser-rum-nuxt'
import { createDemoState, createRumConfiguration } from '../utils/demo-state'

export default defineNuxtPlugin({
  name: 'framework-rum-demo',
  enforce: 'pre',
  setup: function (nuxtApp) {
    var demo = createDemoState()
    try {
      datafluxRum.init(
        createRumConfiguration(
          nuxtRumPlugin({
            nuxtApp: nuxtApp,
            router: useRouter()
          }),
          demo
        )
      )
      demo.markReady()
    } catch (error) {
      demo.recordSetupError(error)
    }
  }
})
