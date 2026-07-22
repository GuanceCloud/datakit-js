<template>
  <main class="demo-shell">
    <header class="demo-header">
      <div>
        <h1>Nuxt RUM Plugin</h1>
        <p>Nuxt pages view tracking and application error handling</p>
      </div>
      <DemoStatus mode="badge" />
    </header>
    <div class="demo-grid">
      <section class="demo-workspace">
        <nav class="demo-nav">
          <NuxtLink id="go-home" to="/">Home</NuxtLink>
          <NuxtLink id="go-user" to="/users/42">User 42</NuxtLink>
          <NuxtLink id="change-query" to="/users/42?tab=activity">Query only</NuxtLink>
        </nav>
        <NuxtPage />
      </section>
      <DemoStatus mode="panel" />
    </div>
  </main>
</template>
