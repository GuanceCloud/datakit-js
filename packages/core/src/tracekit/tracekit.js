import { instrumentMethod } from '../helper/instrumentMethod'
import { isNullUndefinedDefaultValue } from '../helper/tools'
import { computeStackTrace } from './computeStackTrace'

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#Error_types
var ERROR_TYPES_RE =
  /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?([\s\S]*)$/
/**
 * Cross-browser collection of unhandled errors
 *
 * Supports:
 * - Firefox: full stack trace with line numbers, plus column number
 * on top frame; column number is not guaranteed
 * - Opera: full stack trace with line and column numbers
 * - Chrome: full stack trace with line and column numbers
 * - Safari: line and column number for the top frame only; some frames
 * may be missing, and column number is not guaranteed
 * - IE: line and column number for the top frame only; some frames
 * may be missing, and column number is not guaranteed
 *
 * In theory, TraceKit should work on all of the following versions:
 * - IE5.5+ (only 8.0 tested)
 * - Firefox 0.9+ (only 3.5+ tested)
 * - Opera 7+ (only 10.50 tested; versions 9 and earlier may require
 * Exceptions Have Stacktrace to be enabled in opera:config)
 * - Safari 3+ (only 4+ tested)
 * - Chrome 1+ (only 5+ tested)
 * - Konqueror 3.5+ (untested)
 *
 * Tries to catch all unhandled errors and report them to the
 * callback.
 *
 * Callbacks receive a StackTrace object as described in the
 * computeStackTrace docs.
 *
 * @memberof TraceKit
 * @namespace
 */

export function startUnhandledErrorCollection(callback) {
  var _instrumentOnError = instrumentOnError(callback)
  var _instrumentUnhandledRejection = instrumentUnhandledRejection(callback)
  return {
    stop: function () {
      _instrumentOnError.stop()
      _instrumentUnhandledRejection.stop()
    }
  }
}

/**
 * Install a global onerror handler
 */
function instrumentOnError(callback) {
  return instrumentMethod(window, 'onerror', function (params) {
    var parameters = params.parameters
    var messageObj = parameters[0]
    var url = parameters[1]
    var line = parameters[2]
    var column = parameters[3]
    var errorObj = parameters[4]
    var stackTrace
    if (errorObj instanceof Error) {
      stackTrace = computeStackTrace(errorObj)
    } else {
      var location = {
        url: url,
        column: column,
        line: line
      }
      var parse = tryToParseMessage(messageObj)

      stackTrace = {
        name: parse.name,
        message: parse.message,
        stack: [location]
      }
    }
    callback(stackTrace, isNullUndefinedDefaultValue(errorObj, messageObj))
  })
}
function tryToParseMessage(messageObj) {
  let name
  let message
  if ({}.toString.call(messageObj) === '[object String]') {
    var groups = ERROR_TYPES_RE.exec(messageObj)
    if (groups) {
      name = groups[1]
      message = groups[2]
    }
  }
  return { name: name, message: message }
}
/**
 * Install a global onunhandledrejection handler
 */
function instrumentUnhandledRejection(callback) {
  return instrumentMethod(window, 'onunhandledrejection', function (params) {
    var parameters = params.parameters
    var e = parameters[0]
    var reason = e.reason || 'Empty reason'
    var stack = computeStackTrace(reason)
    callback(stack, reason)
  })
}
