import { matchRequestResourceEntry } from './matchRequestResourceEntry'

describe('matchRequestResourceEntry', () => {
  let originalGetEntriesByName

  beforeEach(() => {
    originalGetEntriesByName = performance.getEntriesByName
  })

  afterEach(() => {
    performance.getEntriesByName = originalGetEntriesByName
  })

  it('should return the closest matching resource entry and mark it as matched', () => {
    const firstEntry = {
      startTime: 11,
      duration: 20,
      fetchStart: 11,
      domainLookupStart: 11,
      domainLookupEnd: 12,
      connectStart: 12,
      connectEnd: 13,
      requestStart: 13,
      responseStart: 20,
      responseEnd: 30,
      toJSON: jasmine.createSpy('toJSON').and.returnValue({ id: 'first' })
    }
    const secondEntry = {
      startTime: 14,
      duration: 20,
      fetchStart: 14,
      domainLookupStart: 14,
      domainLookupEnd: 15,
      connectStart: 15,
      connectEnd: 16,
      requestStart: 16,
      responseStart: 24,
      responseEnd: 34,
      toJSON: jasmine.createSpy('toJSON').and.returnValue({ id: 'second' })
    }
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([firstEntry, secondEntry])

    const request = {
      url: 'https://example.com/resource.js',
      startClocks: {
        relative: 12
      },
      duration: 25
    }

    expect(matchRequestResourceEntry(request)).toEqual({ id: 'first' })
    expect(matchRequestResourceEntry(request)).toEqual({ id: 'second' })
  })

  it('should ignore missing or invalid performance entries', () => {
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([
        {
          startTime: 10,
          duration: -1
        }
      ])

    expect(
      matchRequestResourceEntry({
        url: 'https://example.com/invalid.js',
        startClocks: { relative: 10 },
        duration: 10
      })
    ).toBeUndefined()

    performance.getEntriesByName.and.returnValue([])
    expect(
      matchRequestResourceEntry({
        url: 'https://example.com/empty.js',
        startClocks: { relative: 10 },
        duration: 10
      })
    ).toBeUndefined()
  })
})
