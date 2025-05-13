import { each } from '../helper/tools'
var UNKNOWN_FUNCTION = '?'

/**
 * Computes a stack trace for an exception.
 */
export function computeStackTrace(ex) {
  var stack = []

  var stackProperty = tryToGetString(ex, 'stack')
  var exString = String(ex)
  if (stackProperty && stackProperty.startsWith(exString)) {
    stackProperty = stackProperty.slice(exString.length)
  }
  if (stackProperty) {
    each(stackProperty.split('\n'), function (line) {
      var stackFrame =
        parseChromeLine(line) ||
        parseChromeAnonymousLine(line) ||
        parseWinLine(line) ||
        parseGeckoLine(line)
      if (stackFrame) {
        if (!stackFrame.func && stackFrame.line) {
          stackFrame.func = UNKNOWN_FUNCTION
        }
        stack.push(stackFrame)
      }
    })
  }

  return {
    message: tryToGetString(ex, 'message'),
    name: tryToGetString(ex, 'name'),
    stack: stack
  }
}
var fileUrl =
  '((?:file|https?|blob|chrome-extension|electron|native|eval|webpack|<anonymous>|\\w+\\.|\\/).*?)'

var filePosition = '(?::(\\d+))'
var CHROME_LINE_RE = new RegExp(
  '^\\s*at (.*?) ?\\(' +
    fileUrl +
    filePosition +
    '?' +
    filePosition +
    '?\\)?\\s*$',
  'i'
)
var CHROME_EVAL_RE = new RegExp(
  '\\((\\S*)' + filePosition + filePosition + '\\)'
)

function parseChromeLine(line) {
  var parts = CHROME_LINE_RE.exec(line)

  if (!parts) {
    return
  }

  var isNative = parts[2] && parts[2].indexOf('native') === 0 // start of line
  var isEval = parts[2] && parts[2].indexOf('eval') === 0 // start of line
  var submatch = CHROME_EVAL_RE.exec(parts[2])

  if (isEval && submatch) {
    // throw out eval line/column and use top-most line/column number
    parts[2] = submatch[1] // url
    parts[3] = submatch[2] // line
    parts[4] = submatch[3] // column
  }

  return {
    args: isNative ? [parts[2]] : [],
    column: parts[4] ? +parts[4] : undefined,
    func: parts[1] || UNKNOWN_FUNCTION,
    line: parts[3] ? +parts[3] : undefined,
    url: !isNative ? parts[2] : undefined
  }
}

var CHROME_ANONYMOUS_FUNCTION_RE = new RegExp(
  '^\\s*at ?' + fileUrl + filePosition + '?' + filePosition + '??\\s*$',
  'i'
)

function parseChromeAnonymousLine(line) {
  var parts = CHROME_ANONYMOUS_FUNCTION_RE.exec(line)

  if (!parts) {
    return
  }

  return {
    args: [],
    column: parts[3] ? +parts[3] : undefined,
    func: UNKNOWN_FUNCTION,
    line: parts[2] ? +parts[2] : undefined,
    url: parts[1]
  }
}

var WINJS_LINE_RE =
  /^\s*at (?:((?:\[object object\])?.+) )?\(?((?:file|ms-appx|https?|webpack|blob):.*?):(\d+)(?::(\d+))?\)?\s*$/i

function parseWinLine(line) {
  var parts = WINJS_LINE_RE.exec(line)
  if (!parts) {
    return
  }

  return {
    args: [],
    column: parts[4] ? +parts[4] : undefined,
    func: parts[1] || UNKNOWN_FUNCTION,
    line: +parts[3],
    url: parts[2]
  }
}

var GECKO_LINE_RE =
  /^\s*(.*?)(?:\((.*?)\))?(?:^|@)((?:file|https?|blob|chrome|webpack|resource|capacitor|\[native).*?|[^@]*bundle|\[wasm code\])(?::(\d+))?(?::(\d+))?\s*$/i
var GECKO_EVAL_RE = /(\S+) line (\d+)(?: > eval line \d+)* > eval/i

function parseGeckoLine(line) {
  var parts = GECKO_LINE_RE.exec(line)
  if (!parts) {
    return
  }

  var isEval = parts[3] && parts[3].indexOf(' > eval') > -1
  var submatch = GECKO_EVAL_RE.exec(parts[3])

  if (isEval && submatch) {
    // throw out eval line/column and use top-most line number
    parts[3] = submatch[1]
    parts[4] = submatch[2]
    parts[5] = undefined // no column when eval
  }

  return {
    args: parts[2] ? parts[2].split(',') : [],
    column: parts[5] ? +parts[5] : undefined,
    func: parts[1] || UNKNOWN_FUNCTION,
    line: parts[4] ? +parts[4] : undefined,
    url: parts[3]
  }
}

function tryToGetString(candidate, property) {
  if (typeof candidate !== 'object' || !candidate || !(property in candidate)) {
    return undefined
  }
  var value = candidate[property]
  return typeof value === 'string' ? value : undefined
}
