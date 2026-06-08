import { noop } from '@cloudcare/browser-core'

export function makeRumRecorderApiStub() {
  return {
    getReplayStats: function () {
      return undefined
    },
    onRumStart: noop,
    isRecording: function () {
      return false
    }
  }
}

