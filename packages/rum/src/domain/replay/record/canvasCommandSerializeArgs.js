function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer)
  var binary = ''
  for (var index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

var canvasObjectRefMap = new WeakMap()

function isTypedArray(value) {
  return (
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Int16Array ||
    value instanceof Int8Array ||
    value instanceof Uint8ClampedArray
  )
}

function variableListFor(context, constructorName) {
  var contextMap = canvasObjectRefMap.get(context)
  if (!contextMap) {
    contextMap = new Map()
    canvasObjectRefMap.set(context, contextMap)
  }
  if (!contextMap.has(constructorName)) {
    contextMap.set(constructorName, [])
  }
  return contextMap.get(constructorName)
}

function serializeCanvasObjectRef(value, context) {
  if (!value || typeof value !== 'object' || !context || !value.constructor) {
    return value
  }

  var constructorName = value.constructor.name || 'Object'
  var objectList = variableListFor(context, constructorName)
  var objectIndex = objectList.indexOf(value)
  if (objectIndex === -1) {
    objectIndex = objectList.length
    objectList.push(value)
  }

  return {
    rr_type: constructorName,
    index: objectIndex
  }
}

export function serializeCanvasCommandArg(value, context) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return serializeCanvasCommandArg(item, context)
    })
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (isTypedArray(value)) {
    return {
      rr_type: value.constructor.name,
      args: [Array.prototype.slice.call(value)]
    }
  }

  if (value instanceof ArrayBuffer) {
    return {
      rr_type: 'ArrayBuffer',
      base64: arrayBufferToBase64(value)
    }
  }

  if (value instanceof DataView) {
    return {
      rr_type: 'DataView',
      args: [
        serializeCanvasCommandArg(value.buffer, context),
        value.byteOffset,
        value.byteLength
      ]
    }
  }

  if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
    return {
      rr_type: 'ImageData',
      args: [
        serializeCanvasCommandArg(value.data, context),
        value.width,
        value.height
      ]
    }
  }

  if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
    return {
      rr_type: 'HTMLImageElement',
      src: value.src
    }
  }

  return serializeCanvasObjectRef(value, context)
}

export function serializeCanvasCommandArgs(args, context) {
  return Array.prototype.slice.call(args).map(function (arg) {
    return serializeCanvasCommandArg(arg, context)
  })
}
