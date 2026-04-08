import { Observable } from '@cloudcare/browser-core'
import { createClickChain } from './clickChain'

function createClick(eventOverrides) {
  const stopObservable = new Observable()
  let stopped = false
  const click = {
    event: Object.assign(
      {
        target: document.createElement('button'),
        clientX: 10,
        clientY: 20,
        timeStamp: 100
      },
      eventOverrides
    ),
    stopObservable,
    isStopped: () => stopped,
    stop() {
      stopped = true
      stopObservable.notify()
    }
  }

  return click
}

describe('clickChain', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should append similar clicks and finalize when all clicks stop', () => {
    const target = document.createElement('button')
    const firstClick = createClick({
      target,
      timeStamp: 100,
      clientX: 10,
      clientY: 10
    })
    const secondClick = createClick({
      target,
      timeStamp: 200,
      clientX: 20,
      clientY: 20
    })
    const finalized = jasmine.createSpy('finalized')
    const chain = createClickChain(firstClick, finalized)

    expect(chain.tryAppend(secondClick)).toBeTrue()

    jasmine.clock().tick(1000)
    expect(finalized).not.toHaveBeenCalled()

    firstClick.stop()
    expect(finalized).not.toHaveBeenCalled()

    secondClick.stop()
    expect(finalized).toHaveBeenCalledWith([firstClick, secondClick])
  })

  it('should reject dissimilar clicks and finalize the current chain', () => {
    const firstTarget = document.createElement('button')
    const secondTarget = document.createElement('a')
    const firstClick = createClick({
      target: firstTarget,
      timeStamp: 100
    })
    const secondClick = createClick({
      target: secondTarget,
      timeStamp: 150
    })
    const finalized = jasmine.createSpy('finalized')
    const chain = createClickChain(firstClick, finalized)

    expect(chain.tryAppend(secondClick)).toBeFalse()

    firstClick.stop()
    expect(finalized).toHaveBeenCalledWith([firstClick])
  })

  it('should stop accepting clicks after stop() is called', () => {
    const target = document.createElement('button')
    const firstClick = createClick({ target, timeStamp: 100 })
    const secondClick = createClick({ target, timeStamp: 200 })
    const finalized = jasmine.createSpy('finalized')
    const chain = createClickChain(firstClick, finalized)

    chain.stop()

    expect(chain.tryAppend(secondClick)).toBeFalse()
    firstClick.stop()
    expect(finalized).toHaveBeenCalledWith([firstClick])
  })

  it('should stop accepting new clicks after the timeout window closes', () => {
    const target = document.createElement('button')
    const firstClick = createClick({ target, timeStamp: 100 })
    const secondClick = createClick({ target, timeStamp: 150 })
    const finalized = jasmine.createSpy('finalized')
    const chain = createClickChain(firstClick, finalized)

    jasmine.clock().tick(1000)

    expect(chain.tryAppend(secondClick)).toBeFalse()
    expect(finalized).not.toHaveBeenCalled()

    firstClick.stop()
    expect(finalized).toHaveBeenCalledWith([firstClick])
  })

  it('should reject clicks that are too far apart in event time even before the timeout closes', () => {
    const target = document.createElement('button')
    const firstClick = createClick({ target, timeStamp: 100 })
    const secondClick = createClick({ target, timeStamp: 1300 })
    const finalized = jasmine.createSpy('finalized')
    const chain = createClickChain(firstClick, finalized)

    expect(chain.tryAppend(secondClick)).toBeFalse()

    firstClick.stop()
    expect(finalized).toHaveBeenCalledWith([firstClick])
  })
})
