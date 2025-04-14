import { addEventListener } from './addEventListener'
import { DOM_EVENT } from '../helper/enums'
import { noop } from '../helper/tools'
export function runOnReadyState(expectedReadyState, callback) {
  if (
    document.readyState === expectedReadyState ||
    document.readyState === 'complete'
  ) {
    callback()
    return { stop: noop }
  } else {
    var eventName =
      expectedReadyState === 'complete'
        ? DOM_EVENT.LOAD
        : DOM_EVENT.DOM_CONTENT_LOADED
    return addEventListener(window, eventName, callback, { once: true })
  }
}
