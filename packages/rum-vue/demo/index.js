import { createApp, defineComponent, h, ref } from 'vue'
import {
  RouterView,
  createRouter,
  createWebHistory,
  useRoute,
  useRouter
} from 'vue-router'
import { vuePlugin } from '../src'
import {
  createFrameworkDemo,
  createRumConfiguration
} from '../../../demo/framework-demo-runtime'

var demo = createFrameworkDemo('vue')

var RouteContent = defineComponent({
  name: 'RouteContent',
  props: { label: String },
  setup: function (props) {
    return function () {
      return h('p', props.label)
    }
  }
})

var CrashProbe = defineComponent({
  name: 'CrashProbe',
  props: { active: Boolean },
  setup: function (props) {
    return function () {
      if (props.active) {
        throw new Error('Vue demo render error')
      }
      return null
    }
  }
})

var App = defineComponent({
  name: 'FrameworkDemoApp',
  setup: function () {
    var router = useRouter()
    var route = useRoute()
    var shouldCrash = ref(false)

    return function () {
      return h('div', [
        h('h2', 'Router workspace'),
        h(
          'div',
          { class: 'demo-route', id: 'current-route' },
          route.fullPath
        ),
        h('div', { class: 'demo-actions' }, [
          h('button', { class: 'demo-button', id: 'go-home', onClick: function () { router.push('/') } }, 'Home'),
          h('button', { class: 'demo-button', id: 'go-user', onClick: function () { router.push('/users/42') } }, 'User 42'),
          h('button', { class: 'demo-button', id: 'change-query', onClick: function () { router.push('/users/42?tab=activity') } }, 'Query only'),
          h('button', { class: 'demo-button demo-button--error', id: 'trigger-error', onClick: function () { shouldCrash.value = true } }, 'Trigger render error')
        ]),
        h(CrashProbe, { active: shouldCrash.value }),
        h(RouterView)
      ])
    }
  }
})

var router = createRouter({
  history: createWebHistory('/framework-vue/'),
  routes: [
    { path: '/', component: RouteContent, props: { label: 'Home route' } },
    {
      path: '/users/:id',
      component: RouteContent,
      props: { label: 'Dynamic user route' }
    }
  ]
})
var app = createApp(App)

try {
  window.DATAFLUX_RUM.init(
    createRumConfiguration('vue', vuePlugin({ app: app, router: router }), demo)
  )
  app.use(router)
  app.mount('#app')
  demo.markReady()
} catch (error) {
  demo.recordSetupError(error)
}
