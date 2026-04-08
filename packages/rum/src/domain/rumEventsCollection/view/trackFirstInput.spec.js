import { trackFirstInput } from './trackFirstInput'

describe('trackFirstInput', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe')
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instance = this
    }
  }

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    FakePerformanceObserver.supportedEntryTypes = ['first-input']
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should report first input delay and selector before first hidden', () => {
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('button')
    target.setAttribute('data-testid', 'confirm')
    document.body.appendChild(target)

    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 100
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'first-input',
            startTime: 40,
            processingStart: 55,
            target
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      delay: 15,
      time: 40,
      targetSelector: 'BUTTON[data-testid="confirm"]'
    })

    tracking.stop()
    target.remove()
  })

  it('should clamp negative delay to zero and ignore non element targets', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 100
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'first-input',
            startTime: 40,
            processingStart: 35,
            target: document.createTextNode('text')
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      delay: 0,
      time: 40,
      targetSelector: undefined
    })

    tracking.stop()
  })

  it('should ignore first input entries after the first hidden time', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 30
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'first-input',
            startTime: 40,
            processingStart: 55,
            target: document.createElement('button')
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should pick the first valid first-input entry from a mixed entry list', () => {
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('button')
    target.setAttribute('data-testid', 'confirm')
    document.body.appendChild(target)

    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 100
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            startTime: 10,
            processingStart: 20,
            target
          },
          {
            entryType: 'first-input',
            startTime: 40,
            processingStart: 50,
            target
          },
          {
            entryType: 'first-input',
            startTime: 60,
            processingStart: 90,
            target
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      delay: 10,
      time: 40,
      targetSelector: 'BUTTON[data-testid="confirm"]'
    })

    tracking.stop()
    target.remove()
  })

  it('should disconnect the performance observer when stopped', () => {
    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => Infinity
      },
      jasmine.createSpy('callback')
    )

    tracking.stop()

    expect(FakePerformanceObserver.instance.disconnect).toHaveBeenCalled()
  })

  it('should ignore entries that are not first-input entries', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 100
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            startTime: 40,
            processingStart: 55,
            target: document.createElement('button')
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should ignore first-input entries at the first-hidden boundary', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstInput(
      {},
      {
        getTimeStamp: () => 40
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'first-input',
            startTime: 40,
            processingStart: 50,
            target: document.createElement('button')
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })
})
