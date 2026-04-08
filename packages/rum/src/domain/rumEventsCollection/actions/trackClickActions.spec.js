import { FrustrationType } from '@cloudcare/browser-core'
import { finalizeClicks } from './trackClickActions'

function createClick(overrides) {
  const frustrations = []
  const click = {
    event: {
      timeStamp: 0,
      target: document.createElement('button')
    },
    stop: jasmine.createSpy('stop'),
    validate: jasmine.createSpy('validate'),
    discard: jasmine.createSpy('discard'),
    addFrustration(type) {
      frustrations.push(type)
    },
    hasError: () => false,
    hasPageActivity: () => false,
    getUserActivity: () => ({
      selection: false,
      scroll: false,
      input: false
    })
  }

  Object.assign(click, overrides)
  click.frustrations = frustrations
  return click
}

describe('trackClickActions', () => {
  it('should discard individual clicks and validate the rage click when rage is detected', () => {
    const target = document.createElement('div')
    const clicks = [100, 300, 700].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      stop: jasmine.createSpy('rageStop'),
      validate: jasmine.createSpy('rageValidate'),
      hasError: () => true
    })

    finalizeClicks(clicks, rageClick)

    clicks.forEach((click) => {
      expect(click.discard).toHaveBeenCalled()
      expect(click.validate).not.toHaveBeenCalled()
    })
    expect(rageClick.stop).toHaveBeenCalled()
    expect(rageClick.validate).toHaveBeenCalledWith(
      clicks.map((click) => click.event)
    )
    expect(rageClick.frustrations).toEqual([
      FrustrationType.RAGE_CLICK,
      FrustrationType.DEAD_CLICK,
      FrustrationType.ERROR_CLICK
    ])
  })

  it('should discard the rage click and validate each click when rage is not detected', () => {
    const target = document.createElement('div')
    const clicks = [0, 1500].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      discard: jasmine.createSpy('rageDiscard')
    })

    finalizeClicks(clicks, rageClick)

    expect(rageClick.discard).toHaveBeenCalled()
    expect(rageClick.validate).not.toHaveBeenCalled()
    clicks.forEach((click) => {
      expect(click.validate).toHaveBeenCalled()
      expect(click.discard).not.toHaveBeenCalled()
    })
  })

  it('should propagate per-click frustrations before validating a non-rage chain', () => {
    const deadClick = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      }
    })
    const errorClick = createClick({
      event: {
        timeStamp: 1500,
        target: document.createElement('input')
      },
      hasError: () => true,
      getUserActivity: () => ({
        selection: false,
        scroll: false,
        input: true
      })
    })

    finalizeClicks([deadClick, errorClick], createClick())

    expect(deadClick.frustrations).toEqual([FrustrationType.DEAD_CLICK])
    expect(errorClick.frustrations).toEqual([FrustrationType.ERROR_CLICK])
    expect(deadClick.validate).toHaveBeenCalled()
    expect(errorClick.validate).toHaveBeenCalled()
  })

  it('should keep only the rage frustration when no dead or error condition is met', () => {
    const target = document.createElement('textarea')
    const clicks = [100, 300, 700].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      stop: jasmine.createSpy('rageStop'),
      validate: jasmine.createSpy('rageValidate'),
      hasError: () => false
    })

    finalizeClicks(clicks, rageClick)

    expect(rageClick.frustrations).toEqual([FrustrationType.RAGE_CLICK])
    expect(rageClick.validate).toHaveBeenCalled()
  })
})
