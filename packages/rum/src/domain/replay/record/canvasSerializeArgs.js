function dataUrlToBase64(dataUrl) {
  var parts = dataUrl.split(',')
  return parts.length > 1 ? parts[1] : ''
}

var BASE64_PAYLOAD_REGEXP =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function getMimeTypeFromDataUrl(dataUrl) {
  var match = /^data:([^;,]+)/.exec(dataUrl)
  return match ? match[1] : undefined
}

function takeBase64Sample(base64, fromStart) {
  if (typeof base64 !== 'string' || !base64) {
    return undefined
  }
  if (base64.length <= 32) {
    return base64
  }
  return fromStart ? base64.slice(0, 32) : base64.slice(-32)
}

function getBase64Window(base64, centerIndex) {
  if (
    typeof base64 !== 'string' ||
    !base64 ||
    typeof centerIndex !== 'number' ||
    centerIndex < 0
  ) {
    return undefined
  }
  var start = Math.max(0, centerIndex - 16)
  var end = Math.min(base64.length, centerIndex + 17)
  return base64.slice(start, end)
}

function getBase64InvalidCharacterIndex(base64) {
  if (typeof base64 !== 'string') {
    return undefined
  }
  for (var index = 0; index < base64.length; index += 1) {
    var character = base64.charAt(index)
    var isAlphaNumeric =
      (character >= 'A' && character <= 'Z') ||
      (character >= 'a' && character <= 'z') ||
      (character >= '0' && character <= '9')
    if (
      !isAlphaNumeric &&
      character !== '+' &&
      character !== '/' &&
      character !== '='
    ) {
      return index
    }
  }
  return undefined
}

function getBase64FirstPaddingIndex(base64) {
  if (typeof base64 !== 'string') {
    return undefined
  }
  var paddingIndex = base64.indexOf('=')
  return paddingIndex === -1 ? undefined : paddingIndex
}

function hasMidstreamBase64Padding(base64) {
  var firstPaddingIndex = getBase64FirstPaddingIndex(base64)
  if (typeof firstPaddingIndex === 'undefined') {
    return false
  }
  for (var index = firstPaddingIndex; index < base64.length; index += 1) {
    if (base64.charAt(index) !== '=') {
      return true
    }
  }
  return false
}

export function isValidEncodedCanvasDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) {
    return false
  }
  var base64 = dataUrlToBase64(dataUrl)
  return !!base64 && BASE64_PAYLOAD_REGEXP.test(base64)
}

export function getEncodedCanvasDataUrlDiagnostics(dataUrl) {
  var base64 = dataUrlToBase64(dataUrl)
  var firstPaddingIndex = getBase64FirstPaddingIndex(base64)
  var invalidCharacterIndex = getBase64InvalidCharacterIndex(base64)
  return {
    mimeType: getMimeTypeFromDataUrl(dataUrl),
    dataUrlLength: typeof dataUrl === 'string' ? dataUrl.length : undefined,
    base64Length: base64 ? base64.length : undefined,
    base64Prefix: takeBase64Sample(base64, true),
    base64Suffix: takeBase64Sample(base64, false),
    firstPaddingIndex: firstPaddingIndex,
    firstPaddingWindow: getBase64Window(base64, firstPaddingIndex),
    invalidCharacterIndex: invalidCharacterIndex,
    invalidCharacterWindow: getBase64Window(base64, invalidCharacterIndex),
    hasMidstreamPadding: hasMidstreamBase64Padding(base64)
  }
}

export function buildSerializedCanvasImage(dataUrl, mimeType) {
  var resolvedMimeType = getMimeTypeFromDataUrl(dataUrl) || mimeType
  return {
    rr_type: 'ImageBitmap',
    args: [
      {
        rr_type: 'Blob',
        data: [
          {
            rr_type: 'ArrayBuffer',
            base64: dataUrlToBase64(dataUrl)
          }
        ],
        type: resolvedMimeType
      }
    ]
  }
}

export function estimateEncodedBytesFromDataUrl(dataUrl) {
  var base64 = dataUrlToBase64(dataUrl)
  return Math.ceil((base64.length * 3) / 4)
}
