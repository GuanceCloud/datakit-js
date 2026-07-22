<script setup>
const route = useRoute()
</script>

<template>
  <h2>Router workspace</h2>
  <div id="current-route" class="demo-route">{{ route.fullPath }}</div>
  <p>Dynamic user route</p>
  <DemoErrorControl />
</template>
