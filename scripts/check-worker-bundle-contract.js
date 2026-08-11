const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const deflateWorkerPath = resolveBundlePath(process.argv[2], 'worker.js')
const canvasWorkerPath = resolveBundlePath(process.argv[3], 'canvas-worker.js')

main().catch(fail)

async function main() {
  checkDeflateWorker(deflateWorkerPath)
  await checkCanvasWorker(canvasWorkerPath)
  console.log('Worker production bundle contracts verified')
}

function checkDeflateWorker(bundlePath) {
  var worker = loadWorkerBundle(bundlePath)

  worker.dispatch({ action: 'init' })
  assertExactKeys(worker.responses[0], ['type', 'version'])
  assert(worker.responses[0].type === 'initialized', 'deflate init type')
  assert(typeof worker.responses[0].version === 'string', 'deflate version')

  var firstText = 'hello worker '
  var secondText = '你好'
  worker.dispatch({
    action: 'write',
    id: 'write-1',
    streamId: 'stream-1',
    data: firstText
  })
  worker.dispatch({
    action: 'write',
    id: 'write-2',
    streamId: 'stream-1',
    data: secondText
  })

  var firstWrite = worker.responses[1]
  var secondWrite = worker.responses[2]
  checkWriteResponse(firstWrite, 'write-1', firstText)
  checkWriteResponse(secondWrite, 'write-2', secondText)

  var inflated = zlib.inflateSync(
    Buffer.concat([
      Buffer.from(firstWrite.result),
      Buffer.from(secondWrite.result),
      Buffer.from(secondWrite.trailer)
    ])
  )
  assert(
    inflated.toString() === firstText + secondText,
    'deflate stream output'
  )

  worker.dispatch({ action: 'reset', streamId: 'stream-1' })
  worker.dispatch({
    action: 'write',
    id: 'write-3',
    streamId: 'stream-1',
    data: secondText
  })
  var resetWrite = worker.responses[3]
  checkWriteResponse(resetWrite, 'write-3', secondText)
  assert(
    zlib
      .inflateSync(
        Buffer.concat([
          Buffer.from(resetWrite.result),
          Buffer.from(resetWrite.trailer)
        ])
      )
      .toString() === secondText,
    'deflate reset output'
  )

  // Exercise the dynamic Huffman and long match-chain paths in the minified
  // production artifact.  A small smoke string would not cover most of the
  // vendored deflate state whose properties are worker-locally mangled.
  var largeText = ''
  for (var index = 0; index < 4096; index += 1) {
    largeText += `${index % 97}:session-replay-worker-contract:${
      index % 13
    }:abcdefghijklmnopqrstuvwxyz\n`
  }
  assert(Buffer.byteLength(largeText) >= 128 * 1024, 'large input size')
  worker.dispatch({ action: 'reset', streamId: 'stream-1' })
  var largeResults = []
  var chunkCharacters = 64 * 1024
  for (var offset = 0; offset < largeText.length; offset += chunkCharacters) {
    var chunk = largeText.slice(offset, offset + chunkCharacters)
    var id = `large-${largeResults.length + 1}`
    worker.dispatch({
      action: 'write',
      id: id,
      streamId: 'stream-1',
      data: chunk
    })
    var response = worker.responses[worker.responses.length - 1]
    checkWriteResponse(response, id, chunk)
    largeResults.push(response)
  }
  var largeInflateParts = largeResults.map(function (response) {
    return Buffer.from(response.result)
  })
  largeInflateParts.push(
    Buffer.from(largeResults[largeResults.length - 1].trailer)
  )
  assert(
    zlib.inflateSync(Buffer.concat(largeInflateParts)).toString() === largeText,
    'large multi-chunk deflate output'
  )
}

function checkWriteResponse(response, id, text) {
  assertExactKeys(response, [
    'type',
    'id',
    'streamId',
    'result',
    'trailer',
    'additionalBytesCount'
  ])
  assert(response.type === 'wrote', `${id} response type`)
  assert(response.id === id, `${id} response id`)
  assert(response.streamId === 'stream-1', `${id} stream id`)
  assert(response.result instanceof Uint8Array, `${id} result bytes`)
  assert(response.trailer instanceof Uint8Array, `${id} trailer bytes`)
  assert(
    response.additionalBytesCount === Buffer.byteLength(text),
    `${id} byte count`
  )
}

async function checkCanvasWorker(bundlePath) {
  var blobSize = 3
  var closedBitmapCount = 0
  var worker = loadWorkerBundle(bundlePath, {
    OffscreenCanvas: function OffscreenCanvas(width, height) {
      this.width = width
      this.height = height
      this.getContext = function () {
        return {
          save: function () {},
          restore: function () {},
          resetTransform: function () {},
          clearRect: function () {},
          drawImage: function () {}
        }
      }
      this.convertToBlob = function (options) {
        return Promise.resolve({
          size: blobSize,
          type: options.type,
          arrayBuffer: function () {
            return Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
          }
        })
      }
    }
  })

  worker.dispatch({ action: 'init' })
  assertExactKeys(worker.responses[0], ['action', 'version'])
  assert(worker.responses[0].action === 'initialized', 'canvas init action')
  assert(typeof worker.responses[0].version === 'string', 'canvas version')

  var encoded = await worker.dispatchAndWait({
    action: 'encode',
    id: 7,
    bitmap: {
      close: function () {
        closedBitmapCount += 1
      }
    },
    width: 100,
    height: 50,
    maxSize: 100,
    maxEncodedBytes: 10,
    mimeType: 'image/webp',
    quality: 0.5
  })
  assertExactKeys(encoded, ['action', 'id', 'dataUrl', 'width', 'height'])
  assert(encoded.action === 'encoded', 'canvas encoded action')
  assert(encoded.id === 7, 'canvas encoded id')
  assert(encoded.dataUrl === 'data:image/webp;base64,AQID', 'canvas data URL')
  assert(encoded.width === 100 && encoded.height === 50, 'canvas dimensions')

  blobSize = 11
  var dropped = await worker.dispatchAndWait({
    action: 'encode',
    id: 8,
    bitmap: {
      close: function () {
        closedBitmapCount += 1
      }
    },
    width: 100,
    height: 50,
    maxSize: 100,
    maxEncodedBytes: 10,
    mimeType: 'image/webp',
    quality: 0.5
  })
  assertExactKeys(dropped, [
    'action',
    'id',
    'reason',
    'encodedBytesCount',
    'width',
    'height'
  ])
  assert(dropped.action === 'dropped', 'canvas dropped action')
  assert(dropped.id === 8, 'canvas dropped id')
  assert(dropped.reason === 'encode_too_large', 'canvas dropped reason')
  assert(dropped.encodedBytesCount === 11, 'canvas dropped byte count')
  assert(closedBitmapCount === 2, 'canvas bitmap release')
}

function loadWorkerBundle(bundlePath, globals) {
  var listener
  var responses = []
  var pendingResponse
  var workerScope = {
    addEventListener: function (type, callback) {
      assert(type === 'message', `${path.basename(bundlePath)} listener type`)
      listener = callback
    },
    postMessage: function (response) {
      responses.push(response)
      if (pendingResponse) {
        var responseWaiter = pendingResponse
        pendingResponse = undefined
        clearTimeout(responseWaiter.timeout)
        responseWaiter.resolve(response)
      }
    }
  }

  global.self = workerScope
  Object.keys(globals || {}).forEach(function (key) {
    global[key] = globals[key]
  })
  delete require.cache[require.resolve(bundlePath)]
  require(bundlePath)
  assert(typeof listener === 'function', `${path.basename(bundlePath)} listener`)

  return {
    responses: responses,
    dispatch: function (data) {
      listener({ data: data })
    },
    dispatchAndWait: function (data) {
      return new Promise(function (resolve, reject) {
        var timeout = setTimeout(function () {
          pendingResponse = undefined
          reject(
            new Error(
              `${path.basename(bundlePath)} did not respond to ${data.action}`
            )
          )
        }, 2000)
        pendingResponse = {
          resolve: resolve,
          timeout: timeout
        }
        listener({ data: data })
      })
    }
  }
}

function resolveBundlePath(input, filename) {
  var bundlePath = input
    ? path.resolve(input)
    : path.resolve(__dirname, `../packages/worker/bundle/${filename}`)
  if (!fs.existsSync(bundlePath)) {
    fail(new Error(`Worker bundle not found: ${bundlePath}`))
  }
  return bundlePath
}

function assertExactKeys(value, expectedKeys) {
  assert(value && typeof value === 'object', 'worker response object')
  var actual = Object.keys(value).sort()
  var expected = expectedKeys.slice().sort()
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `worker response keys: expected ${expected.join(', ')}, got ${actual.join(
      ', '
    )}`
  )
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(`Worker bundle contract failed: ${label}`)
  }
}

function fail(error) {
  console.error(error && error.message ? error.message : error)
  process.exit(1)
}
