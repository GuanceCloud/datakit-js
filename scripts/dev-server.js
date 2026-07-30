const path = require('path')
const http = require('http')
const express = require('express')
const middleware = require('webpack-dev-middleware')
const webpack = require('webpack')
const { WebSocketServer } = require('ws')

const logsConfig = require('../packages/logs/webpack.config')
const rumConfig = require('../packages/rum/webpack.config')
const rumSlimConfig = require('../packages/rum-slim/webpack.config')
const workerConfig = require('../packages/worker/webpack.config')
const reactDemoConfig = require('../packages/rum-react/demo/webpack.config')
const vueDemoConfig = require('../packages/rum-vue/demo/webpack.config')
const angularDemoConfig = require('../packages/rum-angular/demo/webpack.config')

const app = express()
const webSocketSmokeIntakeEvents = []
app.all('*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  // 其它配置
  next()
})
const intakeBodyParser = express.raw({
  type: () => true,
  limit: '2mb'
})
function captureRumIntakeRequest(req, res) {
  if (Buffer.isBuffer(req.body)) {
    try {
      const rows = JSON.parse(req.body.toString('utf8'))
      rows.forEach((row) => {
        if (
          row.tags &&
          row.tags.app_id === 'websocket-smoke' &&
          row.fields &&
          row.fields.resource_type === 'websocket'
        ) {
          const fields = {}
          Object.keys(row.fields).forEach((key) => {
            if (
              key === 'resource_type' ||
              key.indexOf('resource_websocket_') === 0
            ) {
              fields[key] = row.fields[key]
            }
          })
          webSocketSmokeIntakeEvents.push({
            receivedAt: Date.now(),
            fields
          })
        }
      })
    } catch (error) {
      // Other demos can send line protocol or incomplete batches.
    }
  }
  if (webSocketSmokeIntakeEvents.length > 100) {
    webSocketSmokeIntakeEvents.splice(
      0,
      webSocketSmokeIntakeEvents.length - 100
    )
  }
  res.status(204).end()
}
// Keep replay and other demo intake routes body-agnostic.
app.post('/v1/write/rum', intakeBodyParser, captureRumIntakeRequest)
app.post('/v1/write/:type', (req, res) => res.status(204).end())
app.post('/v1/write/:type/:subtype', (req, res) =>
  res.status(204).end()
)
app.get('/__demo/intake', (req, res) => {
  const since = Number(req.query.since) || 0
  res.json({
    events: webSocketSmokeIntakeEvents.filter(
      (event) => event.receivedAt >= since
    )
  })
})
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
const server = http.createServer(app)
const webSocketServer = new WebSocketServer({
  server,
  path: '/ws-echo'
})

webSocketServer.on('connection', (socket) => {
  let receivedMessages = 0
  socket.on('message', (data, isBinary) => {
    receivedMessages += 1
    socket.send(data, { binary: isBinary })
    if (receivedMessages === 2) {
      socket.send('server-push')
    }
  })
  socket.on('error', () => {})
})

server.listen(port, () => console.log(`server listening on port ${port}.`))
