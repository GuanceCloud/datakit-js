import { computeNavigationStart } from './navigationStart'

describe('computeNavigationStart', () => {
  it('should prefer a valid legacy navigation start', () => {
    expect(
      computeNavigationStart(
        {
          timing: { navigationStart: 1000 },
          timeOrigin: 2000,
          now: () => 100
        },
        3000
      )
    ).toBe(1000)
  })

  it('should fall back to timeOrigin when the legacy value is zero', () => {
    expect(
      computeNavigationStart(
        {
          timing: { navigationStart: 0 },
          timeOrigin: 2000,
          now: () => 100
        },
        3000
      )
    ).toBe(2000)
  })

  it('should derive the origin when navigation timing APIs are unavailable', () => {
    expect(
      computeNavigationStart(
        {
          now: () => 125.4
        },
        3000
      )
    ).toBe(2875)
  })
})
