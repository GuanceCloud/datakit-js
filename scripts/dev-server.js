const path = require('path')
const express = require('express')
const middleware = require('webpack-dev-middleware')
const webpack = require('webpack')

const logsConfig = require('../packages/logs/webpack.config')
const rumConfig = require('../packages/rum/webpack.config')
const rumSlimConfig = require('../packages/rum-slim/webpack.config')
const workerConfig = require('../packages/worker/webpack.config')
const reactDemoConfig = require('../packages/rum-react/demo/webpack.config')
const vueDemoConfig = require('../packages/rum-vue/demo/webpack.config')
const angularDemoConfig = require('../packages/rum-angular/demo/webpack.config')

const app = express()
app.all('*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  // 其它配置
  next()
})
app.post('/v1/write/:type', (req, res) => res.status(204).end())
app.post('/v1/write/:type/:subtype', (req, res) => res.status(204).end())
app.use(express.static(path.join(__dirname, '../demo')))
app.use(
  '/framework-react',
  express.static(path.join(__dirname, '../packages/rum-react/demo'))
)
app.use(
  '/framework-vue',
  express.static(path.join(__dirname, '../packages/rum-vue/demo'))
)
app.use(
  '/framework-angular',
  express.static(path.join(__dirname, '../packages/rum-angular/demo'))
)
for (const config of [
  rumConfig,
  rumSlimConfig,
  logsConfig,
  workerConfig,
  reactDemoConfig,
  vueDemoConfig,
  angularDemoConfig
]) {
  app.use(middleware(webpack(config(null, { mode: 'development' }))))
}
for (const framework of ['react', 'vue', 'angular']) {
  app.get(`/framework-${framework}/*`, (req, res) =>
    res.sendFile(
      path.join(__dirname, `../packages/rum-${framework}/demo/index.html`)
    )
  )
}

const port = 8082
app.listen(port, () => console.log(`server listening on port ${port}.`))
