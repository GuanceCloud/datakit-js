import { display } from './display'
import { ONE_KIBI_BYTE } from './byteUtils'
import { detachToJsonMethod } from './serialisation/jsonStringify'

// The maximum size of a single event is 256KiB. By default, we ensure that user-provided data
// going through sanitize fits inside our events, while leaving room for other contexts, metadata, ...
var SANITIZE_DEFAULT_MAX_CHARACTER_COUNT = 220 * ONE_KIBI_BYTE

// Symbol for the root element of the JSONPath used for visited objects
var JSON_PATH_ROOT_ELEMENT = '$'

// When serializing (using JSON.stringify) a key of an object, { key: 42 } gets wrapped in quotes as "key".
// With the separator (:), we need to add 3 characters to the count.
var KEY_DECORATION_LENGTH = 3

/**
 * Ensures user-provided data is 'safe' for the SDK
 * - Deep clones data
 * - Removes cyclic references
 * - Transforms unserializable types to a string representation
 *
 * LIMITATIONS:
 * - Size is in characters, not byte count (may differ according to character encoding)
 * - Size does not take into account indentation that can be applied to JSON.stringify
 * - Non-numerical properties of Arrays are ignored. Same behavior as JSON.stringify
 *
 * @param source              User-provided data meant to be serialized using JSON.stringify
 * @param maxCharacterCount   Maximum number of characters allowed in serialized form
 */

export function sanitize(source, maxCharacterCount) {
  if (maxCharacterCount === undefined) {
    maxCharacterCount = SANITIZE_DEFAULT_MAX_CHARACTER_COUNT
  }
  // Unbind any toJSON function we may have on [] or {} prototypes
  var restoreObjectPrototypeToJson = detachToJsonMethod(Object.prototype)
  var restoreArrayPrototypeToJson = detachToJsonMethod(Array.prototype)

  // Initial call to sanitizeProcessor - will populate containerQueue if source is an Array or a plain Object
  var containerQueue = []
  var visitedObjectsWithPath = new WeakMap()
  var sanitizedData = sanitizeProcessor(
    source,
    JSON_PATH_ROOT_ELEMENT,
    undefined,
    containerQueue,
    visitedObjectsWithPath
  )
  var accumulatedCharacterCount =
    (JSON.stringify(sanitizedData) && JSON.stringify(sanitizedData).length) || 0
  if (accumulatedCharacterCount > maxCharacterCount) {
    warnOverCharacterLimit(maxCharacterCount, 'discarded', source)
    return undefined
  }

  while (
    containerQueue.length > 0 &&
    accumulatedCharacterCount < maxCharacterCount
  ) {
    var containerToProcess = containerQueue.shift()
    var separatorLength = 0 // 0 for the first element, 1 for subsequent elements

    // Arrays and Objects have to be handled distinctly to ensure
    // we do not pick up non-numerical properties from Arrays
    if (Array.isArray(containerToProcess.source)) {
      for (var key = 0; key < containerToProcess.source.length; key++) {
        var targetData = sanitizeProcessor(
          containerToProcess.source[key],
          containerToProcess.path,
          key,
          containerQueue,
          visitedObjectsWithPath
        )

        if (targetData !== undefined) {
          accumulatedCharacterCount += JSON.stringify(targetData).length
        } else {
          // When an element of an Array (targetData) is undefined, it is serialized as null:
          // JSON.stringify([undefined]) => '[null]' - This accounts for 4 characters
          accumulatedCharacterCount += 4
        }
        accumulatedCharacterCount += separatorLength
        separatorLength = 1
        if (accumulatedCharacterCount > maxCharacterCount) {
          warnOverCharacterLimit(maxCharacterCount, 'truncated', source)
          break
        }
        containerToProcess.target[key] = targetData
      }
    } else {
      for (var key in containerToProcess.source) {
        if (
          Object.prototype.hasOwnProperty.call(containerToProcess.source, key)
        ) {
          var targetData = sanitizeProcessor(
            containerToProcess.source[key],
            containerToProcess.path,
            key,
            containerQueue,
            visitedObjectsWithPath
          )
          // When a property of an object has an undefined value, it will be dropped during serialization:
          // JSON.stringify({a:undefined}) => '{}'
          if (targetData !== undefined) {
            accumulatedCharacterCount +=
              JSON.stringify(targetData).length +
              separatorLength +
              key.length +
              KEY_DECORATION_LENGTH
            separatorLength = 1
          }
          if (accumulatedCharacterCount > maxCharacterCount) {
            warnOverCharacterLimit(maxCharacterCount, 'truncated', source)
            break
          }
          containerToProcess.target[key] = targetData
        }
      }
    }
  }

  // Rebind detached toJSON functions
  restoreObjectPrototypeToJson()
  restoreArrayPrototypeToJson()

  return sanitizedData
}

/**
 * Internal function to factorize the process common to the
 * initial call to sanitize, and iterations for Arrays and Objects
 *
 */
function sanitizeProcessor(
  source,
  parentPath,
  key,
  queue,
  visitedObjectsWithPath
) {
  // Start by handling toJSON, as we want to sanitize its output
  var sourceToSanitize = tryToApplyToJSON(source)

  if (!sourceToSanitize || typeof sourceToSanitize !== 'object') {
    return sanitizePrimitivesAndFunctions(sourceToSanitize)
  }

  var sanitizedSource = sanitizeObjects(sourceToSanitize)
  if (
    sanitizedSource !== '[Object]' &&
    sanitizedSource !== '[Array]' &&
    sanitizedSource !== '[Error]'
  ) {
    return sanitizedSource
  }

  // Handle potential cyclic references
  // We need to use source as sourceToSanitize could be a reference to a new object
  // At this stage, we know the source is an object type
  var sourceAsObject = source
  if (visitedObjectsWithPath.has(sourceAsObject)) {
    return (
      '[Reference seen at ' + visitedObjectsWithPath.get(sourceAsObject) + ']'
    )
  }

  // Add processed source to queue
  var currentPath = key !== undefined ? parentPath + '.' + key : parentPath
  var target = Array.isArray(sourceToSanitize) ? [] : {}
  visitedObjectsWithPath.set(sourceAsObject, currentPath)
  queue.push({ source: sourceToSanitize, target, path: currentPath })

  return target
}

/**
 * Handles sanitization of simple, non-object types
 *
 */
function sanitizePrimitivesAndFunctions(value) {
  // BigInt cannot be serialized by JSON.stringify(), convert it to a string representation
  if (typeof value === 'bigint') {
    return '[BigInt] ' + value.toString()
  }
  // Functions cannot be serialized by JSON.stringify(). Moreover, if a faulty toJSON is present, it needs to be converted
  // so it won't prevent stringify from serializing later
  if (typeof value === 'function') {
    return '[Function] ' + value.name || 'unknown'
  }
  // JSON.stringify() does not serialize symbols.
  if (typeof value === 'symbol') {
    // symbol.description is part of ES2019+
    return '[Symbol] ' + value.description || value.toString()
  }

  return value
}

/**
 * Handles sanitization of object types
 *
 * LIMITATIONS
 * - If a class defines a toStringTag Symbol, it will fall in the catch-all method and prevent enumeration of properties.
 * To avoid this, a toJSON method can be defined.
 * - IE11 does not return a distinct type for objects such as Map, WeakMap, ... These objects will pass through and their
 * properties enumerated if any.
 *
 */
function sanitizeObjects(value) {
  try {
    // Handle events - Keep a simple implementation to avoid breaking changes
    if (value instanceof Event) {
      return sanitizeEvent(value)
    }
    if (value instanceof RegExp) {
      return `[RegExp] ${value.toString()}`
    }
    // Handle all remaining object types in a generic way
    var result = Object.prototype.toString.call(value)
    var match = result.match(/\[object (.*)\]/)
    if (match && match[1]) {
      return '[' + match[1] + ']'
    }
  } catch {
    // If the previous serialization attempts failed, and we cannot convert using
    // Object.prototype.toString, declare the value unserializable
  }
  return '[Unserializable]'
}
function sanitizeEvent(event) {
  return {
    type: event.type,
    isTrusted: event.isTrusted,
    currentTarget: event.currentTarget
      ? sanitizeObjects(event.currentTarget)
      : null,
    target: event.target ? sanitizeObjects(event.target) : null
  }
}
/**
 * Checks if a toJSON function exists and tries to execute it
 *
 */
function tryToApplyToJSON(value) {
  var object = value
  if (object && typeof object.toJSON === 'function') {
    try {
      return object.toJSON()
    } catch {
      // If toJSON fails, we continue by trying to serialize the value manually
    }
  }

  return value
}

/**
 * Helper function to display the warning when the accumulated character count is over the limit
 */
function warnOverCharacterLimit(maxCharacterCount, changeType, source) {
  display.warn(
    'The data provided has been ' +
      changeType +
      ' as it is over the limit of ' +
      maxCharacterCount +
      ' characters:',
    source
  )
}
