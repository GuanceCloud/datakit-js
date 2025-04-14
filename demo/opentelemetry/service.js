const path = require('path')
const express = require('express')
const middleware = require('webpack-dev-middleware')
const webpack = require('webpack')

const app = express()

app.use(express.static(path.join(__dirname, './')))

const port = 8084
app.listen(port, () => console.log(`server listening on port ${port}.`))
