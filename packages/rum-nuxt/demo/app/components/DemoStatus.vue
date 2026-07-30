<script setup>
const props = defineProps({ mode: String })
const state = ref({
  ready: false,
  passed: false,
  viewNames: [],
  errors: [],
  requests: []
})

function update() {
  if (window.__frameworkDemo) {
    state.value = {
      ...window.__frameworkDemo,
      viewNames: [...window.__frameworkDemo.viewNames],
      errors: [...window.__frameworkDemo.errors],
      requests: [...window.__frameworkDemo.requests]
    }
  }
}

onMounted(() => {
  window.addEventListener('framework-demo:update', update)
  update()
})

onBeforeUnmount(() => {
  window.removeEventListener('framework-demo:update', update)
})
</script>

<template>
  <div
    v-if="props.mode === 'badge'"
    id="demo-result"
    class="demo-badge"
    :class="{ passed: state.passed }"
  >
    {{ state.passed ? 'Passed' : state.ready ? 'Running' : 'Starting' }}
  </div>
  <aside v-else class="demo-status">
    <h2>RUM events</h2>
    <div class="demo-kpis">
      <div class="demo-kpi"><span>Views</span><strong id="demo-view-count">{{ state.viewNames.length }}</strong></div>
      <div class="demo-kpi"><span>Errors</span><strong id="demo-error-count">{{ state.errors.length }}</strong></div>
      <div class="demo-kpi"><span>Uploads</span><strong id="demo-request-count">{{ state.requests.length }}</strong></div>
    </div>
    <pre id="demo-log" class="demo-log">{{ JSON.stringify(state, null, 2) }}</pre>
  </aside>
</template>
