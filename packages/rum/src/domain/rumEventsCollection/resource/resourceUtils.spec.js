import { ResourceType } from '@cloudcare/browser-core'
import {
  computePerformanceResourceDetails,
  computeResourceEntryDeliveryType,
  computeResourceEntryDuration,
  computeResourceEntryProtocol,
  computeResourceEntrySize,
  computeResourceEntryType,
  getStrSize,
  hasValidResourceEntryDuration,
  hasValidResourceEntryTimings,
  is304,
  isAllowedRequestUrl,
  isCacheHit,
  isLongDataUrl,
  isResourceEntryRequestType,
  isResourceUrlLimit,
  sanitizeDataUrl
} from './resourceUtils'

describe('resourceUtils', () => {
  let originalTextEncoder
  let originalPreferredNow

  beforeEach(() => {
    originalTextEncoder = window.TextEncoder
    originalPreferredNow = performance.now
  })

  afterEach(() => {
    window.TextEncoder = originalTextEncoder
    performance.now = originalPreferredNow
  })

  it('should compute resource entry type from initiator and pathname', () => {
    expect(
      computeResourceEntryType({
        name: 'https://example.com/index.html',
        initiatorType: 'initial_document'
      })
    ).toBe(ResourceType.DOCUMENT)
    expect(
      computeResourceEntryType({
        name: 'https://example.com/file.css',
        initiatorType: 'link'
      })
    ).toBe(ResourceType.CSS)
    expect(
      computeResourceEntryType({
        name: 'https://example.com/file.png',
        initiatorType: 'image'
      })
    ).toBe(ResourceType.IMAGE)
    expect(
      computeResourceEntryType({
        name: 'not-a-valid-url',
        initiatorType: 'other'
      })
    ).toBe(ResourceType.OTHER)
  })

  it('should expose delivery type, protocol and request helpers', () => {
    expect(computeResourceEntryDeliveryType({ deliveryType: '' })).toBe('other')
    expect(
      computeResourceEntryDeliveryType({ deliveryType: 'cache' })
    ).toBe('cache')
    expect(computeResourceEntryProtocol({ nextHopProtocol: '' })).toBeUndefined()
    expect(
      computeResourceEntryProtocol({ nextHopProtocol: 'h2' })
    ).toBe('h2')
    expect(
      isResourceEntryRequestType({ initiatorType: 'xmlhttprequest' })
    ).toBeTrue()
    expect(isResourceEntryRequestType({ initiatorType: 'img' })).toBeFalse()
  })

  it('should compute string sizes and resource url limits', () => {
    expect(getStrSize('plain')).toBe(5)

    window.TextEncoder = class {
      encode(candidate) {
        return { length: 6 + candidate.length }
      }
    }

    expect(getStrSize('汉字')).toBe(8)
    expect(isResourceUrlLimit('123456', 5)).toBeTrue()
    expect(isResourceUrlLimit('1234', 5)).toBeFalse()
  })

  it('should compute duration, cache status and 304 heuristics', () => {
    expect(
      computeResourceEntryDuration({
        duration: 0,
        startTime: 10,
        responseEnd: 25
      })
    ).toBe(15000000)
    expect(
      computeResourceEntryDuration({
        duration: 12
      })
    ).toBe(12000000)

    expect(
      is304({
        encodedBodySize: 100,
        transferSize: 50
      })
    ).toBeTrue()
    expect(
      is304({
        encodedBodySize: 100,
        transferSize: 150
      })
    ).toBeNull()

    expect(
      isCacheHit({
        transferSize: 1,
        decodedBodySize: 10,
        duration: 5
      })
    ).toBeFalse()
    expect(
      isCacheHit({
        transferSize: 0,
        decodedBodySize: 10,
        duration: 50
      })
    ).toBeTrue()
    expect(
      isCacheHit({
        transferSize: 0,
        decodedBodySize: 0,
        duration: 20
      })
    ).toBeTrue()
  })

  it('should compute performance timing details and validate timing ordering', () => {
    performance.now = () => 100

    const entry = {
      startTime: 0,
      fetchStart: 1,
      redirectStart: 0,
      redirectEnd: 0,
      domainLookupStart: 2,
      domainLookupEnd: 3,
      connectStart: 4,
      secureConnectionStart: 5,
      connectEnd: 6,
      requestStart: 7,
      responseStart: 10,
      responseEnd: 15,
      renderBlockingStatus: 'blocking'
    }

    expect(hasValidResourceEntryDuration({ duration: 1 })).toBeTrue()
    expect(hasValidResourceEntryDuration({ duration: -1 })).toBeFalse()
    expect(hasValidResourceEntryTimings(entry)).toBeTrue()
    expect(
      hasValidResourceEntryTimings({
        ...entry,
        connectEnd: 2
      })
    ).toBeFalse()

    expect(computePerformanceResourceDetails(entry)).toEqual({
      firstbyte: 3000000,
      trans: 5000000,
      downloadTime: {
        duration: 5000000,
        start: 10000000
      },
      firstByteTime: {
        duration: 3000000,
        start: 7000000
      },
      ttfb: 3000000,
      tcp: 2000000,
      connectTime: {
        duration: 2000000,
        start: 4000000
      },
      ssl: 1000000,
      sslTime: {
        duration: 1000000,
        start: 5000000
      },
      dns: 1000000,
      dnsTime: {
        duration: 1000000,
        start: 2000000
      },
      renderBlockingStatus: 'blocking'
    })
  })

  it('should compute resource sizes and filter allowed request urls', () => {
    expect(
      computeResourceEntrySize({
        startTime: 1,
        responseStart: 2,
        encodedBodySize: 10,
        decodedBodySize: 20,
        transferSize: 30
      })
    ).toEqual({
      size: 20,
      encodedBodySize: 10,
      decodedBodySize: 20,
      transferSize: 30
    })
    expect(
      computeResourceEntrySize({
        startTime: 2,
        responseStart: 1
      })
    ).toEqual({
      size: undefined,
      encodedBodySize: undefined,
      decodedBodySize: undefined,
      transferSize: undefined
    })

    expect(
      isAllowedRequestUrl(
        {
          rumEndpoint: 'https://intake.example/rum',
          isIntakeUrl: () => false
        },
        'https://example.com/file.js'
      )
    ).toBeTrue()
    expect(
      isAllowedRequestUrl(
        {
          rumEndpoint: 'https://intake.example/rum',
          isIntakeUrl: (url) => url.indexOf('private') >= 0
        },
        'https://example.com/private'
      )
    ).toBeFalse()
  })

  it('should detect and sanitize long data urls', () => {
    const shortDataUrl = 'data:text/plain;base64,abc'
    const longDataUrl = 'data:text/plain;base64,' + 'a'.repeat(25000)

    expect(isLongDataUrl(shortDataUrl)).toBeFalse()
    expect(isLongDataUrl(longDataUrl)).toBeTrue()
    expect(sanitizeDataUrl(longDataUrl)).toBe('data:text/plain;base64,[...]')
  })
})
