import { datafluxRumWebGL } from '../index'

var globalObject =
  typeof globalThis === 'object'
    ? globalThis
    : typeof self === 'object'
      ? self
      : typeof window === 'object'
        ? window
        : {}
globalObject.DATAFLUX_RUM_WEBGL = datafluxRumWebGL

export { datafluxRumWebGL }
