<script setup>
function triggerError() {
  throw new Error('Nuxt demo event error')
}
</script>

<template>
  <div class="demo-actions">
    <button
      id="trigger-error"
      class="demo-button error"
      type="button"
      @click="triggerError"
    >
      Trigger event error
    </button>
  </div>
</template>
