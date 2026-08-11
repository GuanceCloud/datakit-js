import type { RumPlugin } from '@cloudcare/browser-rum'

export interface WebGLReplayPlugin extends RumPlugin {
  name: 'session-replay-webgl'
}

export declare function webglReplayPlugin(): WebGLReplayPlugin

export declare const datafluxRumWebGL: {
  webglReplayPlugin: typeof webglReplayPlugin
}
