import { getZoneJsOriginalValue } from './getZoneJsOriginalValue'
import { getGlobalObject } from '../init'
import { monitor } from './monitor'
export function setTimeout(callback, delay) {
  return getZoneJsOriginalValue(getGlobalObject(), 'setTimeout')(
    monitor(callback),
    delay
  )
}

export function clearTimeout(timeoutId) {
  getZoneJsOriginalValue(getGlobalObject(), 'clearTimeout')(timeoutId)
}

export function setInterval(callback, delay) {
  return getZoneJsOriginalValue(getGlobalObject(), 'setInterval')(
    monitor(callback),
    delay
  )
}

export function clearInterval(timeoutId) {
  getZoneJsOriginalValue(getGlobalObject(), 'clearInterval')(timeoutId)
}
