import { TelemetryStatusType, TelemetryType } from './types'

describe('telemetry types', () => {
  it('should expose telemetry type constants', () => {
    expect(TelemetryType).toEqual({
      log: 'log',
      configuration: 'configuration',
      usage: 'usage'
    })
  })

  it('should expose telemetry status constants', () => {
    expect(TelemetryStatusType).toEqual({
      debug: 'debug',
      error: 'error'
    })
  })
})
