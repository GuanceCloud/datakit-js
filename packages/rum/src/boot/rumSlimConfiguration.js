import { assign } from '@cloudcare/browser-core'

export function forceRumSlimConfiguration(initConfiguration) {
  return assign({}, initConfiguration, {
    sessionReplaySampleRate: 0,
    sessionReplayOnErrorSampleRate: 0,
    replayCanvasEnabled: false,
    compressIntakeRequests: false
  })
}

