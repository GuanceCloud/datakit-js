import { display } from './display'

export function catchUserErrors(fn, errorMsg) {
  return function() {
    var args = [].slice.call(arguments)
    try {
      return fn.apply(this, args)
    } catch (err) {
      display.error(errorMsg, err)
    }
  }
}