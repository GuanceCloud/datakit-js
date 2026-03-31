import {
  addNewForegroundPeriod,
  closeForegroundPeriod,
  startForegroundContexts
} from './foregroundContexts'

describe('foregroundContexts', () => {
  let originalHasFocus
  let originalPerformanceNow

  beforeEach(() => {
    originalHasFocus = document.hasFocus
    originalPerformanceNow = performance.now
  })

  afterEach(() => {
    document.hasFocus = originalHasFocus
    performance.now = originalPerformanceNow
  })

  it('should create an initial foreground period when the document has focus', () => {
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(true)
    performance.now = jasmine.createSpy('performance.now').and.returnValues(10)

    const foregroundContexts = startForegroundContexts()

    expect(foregroundContexts.isInForegroundAt(11)).toBeTrue()
    expect(foregroundContexts.selectInForegroundPeriodsFor(5, 10)).toEqual([
      { start: 5000000, duration: 5000000 }
    ])

    foregroundContexts.stop()
  })

  it('should track explicit foreground period boundaries', () => {
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(false)
    performance.now = jasmine
      .createSpy('performance.now')
      .and.returnValues(10, 25)

    const foregroundContexts = startForegroundContexts()

    addNewForegroundPeriod()
    closeForegroundPeriod()

    expect(foregroundContexts.isInForegroundAt(15)).toBeTrue()
    expect(foregroundContexts.isInForegroundAt(30)).toBeFalse()
    expect(foregroundContexts.selectInForegroundPeriodsFor(5, 30)).toEqual([
      { start: 5000000, duration: 15000000 }
    ])

    foregroundContexts.stop()
  })

  it('should clear stored periods when stopped', () => {
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(false)
    performance.now = jasmine
      .createSpy('performance.now')
      .and.returnValues(10, 20)

    const foregroundContexts = startForegroundContexts()
    addNewForegroundPeriod()
    closeForegroundPeriod()

    foregroundContexts.stop()

    expect(foregroundContexts.isInForegroundAt(15)).toBeFalse()
    expect(foregroundContexts.selectInForegroundPeriodsFor(5, 30)).toEqual([])
  })
})
