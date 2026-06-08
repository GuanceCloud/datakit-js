const path = require('path')
const express = require('express')
const middleware = require('webpack-dev-middleware')
const webpack = require('webpack')

const logsConfig = require('../packages/logs/webpack.config')
const rumConfig = require('../packages/rum/webpack.config')
const rumSlimConfig = require('../packages/rum-slim/webpack.config')
const workerConfig = require('../packages/worker/webpack.config')

const app = express()
app.all('*', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  // 其它配置
  next()
})
app.use(express.static(path.join(__dirname, '../demo')))
for (const config of [rumConfig, rumSlimConfig, logsConfig, workerConfig]) {
  app.use(middleware(webpack(config(null, { mode: 'development' }))))
}

const port = 8082
app.listen(port, () => console.log(`server listening on port ${port}.`))
