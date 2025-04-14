const path = require('path')
const express = require('express')
const middleware = require('webpack-dev-middleware')
const webpack = require('webpack')

const logsConfig = require('../packages/logs/webpack.config')
const rumConfig = require('../packages/rum/webpack.config')

const app = express()

app.use(express.static(path.join(__dirname, '../demo')))
for (const config of [rumConfig, logsConfig]) {
  app.use(middleware(webpack(config(null, { mode: 'development' }))))
}

const port = 8082
app.listen(port, () => console.log(`server listening on port ${port}.`))
