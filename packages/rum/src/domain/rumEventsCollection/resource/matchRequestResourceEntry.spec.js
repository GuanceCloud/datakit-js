import { createRequestResourceEntryMatcher } from './matchRequestResourceEntry'

describe('matchRequestResourceEntry', () => {
  let originalGetEntriesByName

  beforeEach(() => {
    originalGetEntriesByName = performance.getEntriesByName
  })

  afterEach(() => {
    performance.getEntriesByName = originalGetEntriesByName
  })

  it('should return the closest matching resource entry and mark it as matched', () => {
    const matcher = createRequestResourceEntryMatcher()
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

    expect(matcher.matchRequestResourceEntry(request)).toEqual({ id: 'first' })
    expect(matcher.matchRequestResourceEntry(request)).toEqual({ id: 'second' })
  })

  it('should ignore missing or invalid performance entries', () => {
    const matcher = createRequestResourceEntryMatcher()
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([
        {
          startTime: 10,
          duration: -1
        }
      ])

    expect(
      matcher.matchRequestResourceEntry({
        url: 'https://example.com/invalid.js',
        startClocks: { relative: 10 },
        duration: 10
      })
    ).toBeUndefined()

    performance.getEntriesByName.and.returnValue([])
    expect(
      matcher.matchRequestResourceEntry({
        url: 'https://example.com/empty.js',
        startClocks: { relative: 10 },
        duration: 10
      })
    ).toBeUndefined()
  })

  it('should match entries that are within the one-millisecond error margin', () => {
    const matcher = createRequestResourceEntryMatcher()
    const edgeEntry = {
      startTime: 9,
      duration: 12,
      fetchStart: 9,
      domainLookupStart: 9,
      domainLookupEnd: 10,
      connectStart: 10,
      connectEnd: 11,
      requestStart: 11,
      responseStart: 15,
      responseEnd: 21,
      toJSON: jasmine.createSpy('toJSON').and.returnValue({ id: 'edge' })
    }
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([edgeEntry])

    expect(
      matcher.matchRequestResourceEntry({
        url: 'https://example.com/edge.js',
        startClocks: { relative: 10 },
        duration: 10
      })
    ).toEqual({ id: 'edge' })
  })

  it('should keep matched entry state isolated per matcher instance', () => {
    const firstMatcher = createRequestResourceEntryMatcher()
    const secondMatcher = createRequestResourceEntryMatcher()
    const entry = {
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
      toJSON: jasmine.createSpy('toJSON').and.returnValue({ id: 'shared' })
    }
    performance.getEntriesByName = jasmine
      .createSpy('getEntriesByName')
      .and.returnValue([entry])

    const request = {
      url: 'https://example.com/shared.js',
      startClocks: { relative: 12 },
      duration: 25
    }

    expect(firstMatcher.matchRequestResourceEntry(request)).toEqual({
      id: 'shared'
    })
    expect(secondMatcher.matchRequestResourceEntry(request)).toEqual({
      id: 'shared'
    })
  })
})
