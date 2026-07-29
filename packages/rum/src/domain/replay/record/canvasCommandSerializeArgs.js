function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer)
  var binary = ''
  for (var index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary)
}

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

function serializeCanvasCommandArgWithRegistry(value, context, registry) {
  if (Array.isArray(value)) {
    return value.map(function (item) {
      return serializeCanvasCommandArgWithRegistry(item, context, registry)
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
        serializeCanvasCommandArgWithRegistry(value.buffer, context, registry),
        value.byteOffset,
        value.byteLength
      ]
    }
  }

  if (typeof ImageData !== 'undefined' && value instanceof ImageData) {
    return {
      rr_type: 'ImageData',
      args: [
        serializeCanvasCommandArgWithRegistry(value.data, context, registry),
        value.width,
        value.height
      ]
    }
  }

  if (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) {
    return {
      rr_type: 'HTMLImageElement',
      src: value.currentSrc || value.src
    }
  }

  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    throw new Error('HTMLCanvasElement command arguments require snapshot fallback')
  }

  return registry.serializeObjectRef(value, context)
}

export function createCanvasCommandObjectRefRegistry() {
  var objectRefsByContext = new WeakMap()
  var registry = {
    serializeArg: function (value, context) {
      return serializeCanvasCommandArgWithRegistry(
        value,
        context,
        registry
      )
    },
    serializeArgs: function (args, context) {
      return Array.prototype.slice.call(args).map(function (arg) {
        return serializeCanvasCommandArgWithRegistry(
          arg,
          context,
          registry
        )
      })
    },
    serializeObjectRef: function (value, context) {
      if (
        !value ||
        typeof value !== 'object' ||
        !context ||
        !value.constructor
      ) {
        return value
      }

      var constructorName = value.constructor.name || 'Object'
      var contextRefs = objectRefsByContext.get(context)
      if (!contextRefs) {
        contextRefs = new Map()
        objectRefsByContext.set(context, contextRefs)
      }
      var constructorRefs = contextRefs.get(constructorName)
      if (!constructorRefs) {
        constructorRefs = {
          indexByObject: new WeakMap(),
          nextIndex: 0
        }
        contextRefs.set(constructorName, constructorRefs)
      }
      var objectIndex = constructorRefs.indexByObject.get(value)
      if (objectIndex === undefined) {
        objectIndex = constructorRefs.nextIndex
        constructorRefs.nextIndex += 1
        constructorRefs.indexByObject.set(value, objectIndex)
      }

      return {
        rr_type: constructorName,
        index: objectIndex
      }
    },
    reset: function () {
      objectRefsByContext = new WeakMap()
    }
  }
  return registry
}

var defaultObjectRefRegistry = createCanvasCommandObjectRefRegistry()

export function serializeCanvasCommandArg(value, context) {
  return defaultObjectRefRegistry.serializeArg(value, context)
}

export function serializeCanvasCommandArgs(args, context) {
  return defaultObjectRefRegistry.serializeArgs(args, context)
}
