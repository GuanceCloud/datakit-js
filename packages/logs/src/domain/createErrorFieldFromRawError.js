export function createErrorFieldFromRawError(rawError, options) {
  if (options === undefined) {
    options = {}
  }
  var includeMessage = options.includeMessage || false
  return {
    stack: rawError.stack,
    kind: rawError.type,
    message: includeMessage ? rawError.message : undefined,
    causes: rawError.causes,
    handling: rawError.handling
  }
}
