import { getZoneJsOriginalValue } from './getZoneJsOriginalValue'

describe('getZoneJsOriginalValue', () => {
  let originalZone

  beforeEach(() => {
    originalZone = window.Zone
  })

  afterEach(() => {
    window.Zone = originalZone
  })

  it('should return the zone.js original value when available', () => {
    window.Zone = {
      __symbol__(name) {
        return `__zone_symbol__${name}`
      }
    }
    const original = jasmine.createSpy('original')
    const target = {
      addEventListener: jasmine.createSpy('patched'),
      __zone_symbol__addEventListener: original
    }

    expect(getZoneJsOriginalValue(target, 'addEventListener')).toBe(original)
  })

  it('should fall back to the patched value when no original value is stored', () => {
    window.Zone = undefined
    const patched = jasmine.createSpy('patched')
    const target = {
      addEventListener: patched
    }

    expect(getZoneJsOriginalValue(target, 'addEventListener')).toBe(patched)
  })
})
