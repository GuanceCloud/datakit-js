import {
  computeStackTrace,
  augmentStackTraceWithInitialElement
} from './computeStackTrace'
import { each } from '../helper/tools'
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#Error_types
// eslint-disable-next-line  max-len
var ERROR_TYPES_RE = /^(?:[Uu]ncaught (?:exception: )?)?(?:((?:Eval|Internal|Range|Reference|Syntax|Type|URI|)Error): )?(.*)$/

/**
 * Cross-browser processing of unhandled exceptions
 *
 * Syntax:
 * ```js
 *   subscribe(function(stackInfo) { ... })
 *   unsubscribe(function(stackInfo) { ... })
 *   report(exception)
 *   try { ...code... } catch(ex) { report(ex); }
 * ```
 *
 * Supports:
 *   - Firefox: full stack trace with line numbers, plus column number
 *     on top frame; column number is not guaranteed
 *   - Opera: full stack trace with line and column numbers
 *   - Chrome: full stack trace with line and column numbers
 *   - Safari: line and column number for the top frame only; some frames
 *     may be missing, and column number is not guaranteed
 *   - IE: line and column number for the top frame only; some frames
 *     may be missing, and column number is not guaranteed
 *
 * In theory, TraceKit should work on all of the following versions:
 *   - IE5.5+ (only 8.0 tested)
 *   - Firefox 0.9+ (only 3.5+ tested)
 *   - Opera 7+ (only 10.50 tested; versions 9 and earlier may require
 *     Exceptions Have Stacktrace to be enabled in opera:config)
 *   - Safari 3+ (only 4+ tested)
 *   - Chrome 1+ (only 5+ tested)
 *   - Konqueror 3.5+ (untested)
 *
 * Requires computeStackTrace.
 *
 * Tries to catch all unhandled exceptions and report them to the
 * subscribed handlers. Please note that report will rethrow the
 * exception. This is REQUIRED in order to get a useful stack trace in IE.
 * If the exception does not reach the top of the browser, you will only
 * get a stack trace from the point where report was called.
 *
 * Handlers receive a StackTrace object as described in the
 * computeStackTrace docs.
 *
 * @memberof TraceKit
 * @namespace
 */

/**
 * Reports an unhandled Error.
 * @param {Error} ex
 * @memberof report
 * @throws An exception if an incomplete stack trace is detected (old IE browsers).
 */
export function report(ex) {
  if (lastExceptionStack) {
    if (lastException === ex) {
      return // already caught by an inner catch block, ignore
    }
    processLastException()
  }

  var stack = computeStackTrace(ex)
  lastExceptionStack = stack
  lastException = ex

  // If the stack trace is incomplete, wait for 2 seconds for
  // slow slow IE to see if onerror occurs or not before reporting
  // this exception; otherwise, we will end up with an incomplete
  // stack trace
  setTimeout(
    function () {
      if (lastException === ex) {
        processLastException()
      }
    },
    stack.incomplete ? 2000 : 0
  )
  throw ex // re-throw to propagate to the top level (and cause window.onerror)
}

var handlers = []
var lastException
var lastExceptionStack

/**
 * Add a crash handler.
 * @param {Function} handler
 * @memberof report
 */
export function subscribe(handler) {
  installGlobalHandler()
  installGlobalUnhandledRejectionHandler()
  handlers.push(handler)
}

/**
 * Remove a crash handler.
 * @param {Function} handler
 * @memberof report
 */
export function unsubscribe(handler) {
  for (var i = handlers.length - 1; i >= 0; i -= 1) {
    if (handlers[i] === handler) {
      handlers.splice(i, 1)
    }
  }

  if (handlers.length === 0) {
    uninstallGlobalHandler()
    uninstallGlobalUnhandledRejectionHandler()
  }
}

/**
 * Dispatch stack information to all handlers.
 * @param {StackTrace} stack
 * @param {boolean} isWindowError Is this a top-level window error?
 * @param {Error=} error The error that's being handled (if available, null otherwise)
 * @memberof report
 * @throws An exception if an error occurs while calling an handler.
 */
function notifyHandlers(stack, isWindowError, error) {
  var exception
  each(handlers, function (handler) {
    try {
      handler(stack, isWindowError, error)
    } catch (inner) {
      exception = inner
    }
  })

  if (exception) {
    throw exception
  }
}

var oldOnerrorHandler
var onErrorHandlerInstalled
var oldOnunhandledrejectionHandler
var onUnhandledRejectionHandlerInstalled

/**
 * Ensures all global unhandled exceptions are recorded.
 * Supported by Gecko and IE.
 * @param {Event|string} message Error message.
 * @param {string=} url URL of script that generated the exception.
 * @param {(number|string)=} lineNo The line number at which the error occurred.
 * @param {(number|string)=} columnNo The column number at which the error occurred.
 * @param {Error=} errorObj The actual Error object.
 * @memberof report
 */
export function traceKitWindowOnError(
  message,
  url,
  lineNo,
  columnNo,
  errorObj
) {
  var stack

  if (lastExceptionStack) {
    augmentStackTraceWithInitialElement(lastExceptionStack, url, lineNo)
    processLastException()
  } else if (errorObj) {
    stack = computeStackTrace(errorObj)
    notifyHandlers(stack, true, errorObj)
  } else {
    var location = {
      url: url,
      column: columnNo,
      line: lineNo
    }

    var name
    var msg = message
    if ({}.toString.call(message) === '[object String]') {
      var groups = ERROR_TYPES_RE.exec(msg)
      if (groups) {
        name = groups[1]
        msg = groups[2]
      }
    }

    stack = {
      name: name,
      message: typeof msg === 'string' ? msg : undefined,
      stack: [location]
    }

    notifyHandlers(stack, true, message)
  }

  if (oldOnerrorHandler) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return oldOnerrorHandler.apply(this, arguments)
  }

  return false
}

/**
 * Ensures all unhandled rejections are recorded.
 * @param {PromiseRejectionEvent} e event.
 * @memberof report
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onunhandledrejection
 * @see https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
 */
function traceKitWindowOnUnhandledRejection(e) {
  var reason = e.reason || 'Empty reason'
  var stack = computeStackTrace(reason)
  notifyHandlers(stack, true, reason)
}

/**
 * Install a global onerror handler
 * @memberof report
 */
function installGlobalHandler() {
  if (onErrorHandlerInstalled) {
    return
  }

  oldOnerrorHandler = window.onerror
  window.onerror = traceKitWindowOnError
  onErrorHandlerInstalled = true
}

/**
 * Uninstall the global onerror handler
 * @memberof report
 */
function uninstallGlobalHandler() {
  if (onErrorHandlerInstalled) {
    window.onerror = oldOnerrorHandler
    onErrorHandlerInstalled = false
  }
}

/**
 * Install a global onunhandledrejection handler
 * @memberof report
 */
function installGlobalUnhandledRejectionHandler() {
  if (onUnhandledRejectionHandlerInstalled) {
    return
  }

  oldOnunhandledrejectionHandler =
    window.onunhandledrejection !== null
      ? window.onunhandledrejection
      : undefined
  window.onunhandledrejection = traceKitWindowOnUnhandledRejection
  onUnhandledRejectionHandlerInstalled = true
}

/**
 * Uninstall the global onunhandledrejection handler
 * @memberof report
 */
function uninstallGlobalUnhandledRejectionHandler() {
  if (onUnhandledRejectionHandlerInstalled) {
    window.onunhandledrejection = oldOnunhandledrejectionHandler
    onUnhandledRejectionHandlerInstalled = false
  }
}

/**
 * Process the most recent exception
 * @memberof report
 */
function processLastException() {
  var currentLastExceptionStack = lastExceptionStack
  var currentLastException = lastException
  lastExceptionStack = undefined
  lastException = undefined
  notifyHandlers(currentLastExceptionStack, false, currentLastException)
}
