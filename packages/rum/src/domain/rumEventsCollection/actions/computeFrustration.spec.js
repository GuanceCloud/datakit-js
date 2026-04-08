import { FrustrationType } from '@cloudcare/browser-core'
import { computeFrustration, isDead, isRage } from './computeFrustration'

function createClick(overrides) {
  const frustrations = []
  const click = {
    event: {
      timeStamp: 0,
      target: document.createElement('button')
    },
    getUserActivity: () => ({
      selection: false,
      scroll: false,
      input: false
    }),
    hasError: () => false,
    hasPageActivity: () => false,
    addFrustration: (type) => frustrations.push(type)
  }

  Object.assign(click, overrides)
  click.frustrations = frustrations
  return click
}

describe('computeFrustration', () => {
  it('should detect rage clicks and aggregate dead/error frustrations on the chain', () => {
    const target = document.createElement('div')
    const rageClick = {
      frustrations: [],
      addFrustration(type) {
        this.frustrations.push(type)
      },
      hasError: () => true
    }
    const clicks = [100, 400, 900].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )

    expect(isRage(clicks)).toBeTrue()
    expect(computeFrustration(clicks, rageClick)).toEqual({ isRage: true })
    expect(rageClick.frustrations).toEqual([
      FrustrationType.RAGE_CLICK,
      FrustrationType.DEAD_CLICK,
      FrustrationType.ERROR_CLICK
    ])
  })

  it('should mark individual dead and error clicks when not a rage click', () => {
    const deadClick = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      }
    })
    const errorClick = createClick({
      event: {
        timeStamp: 1500,
        target: document.createElement('button')
      },
      hasError: () => true,
      getUserActivity: () => ({
        selection: false,
        scroll: false,
        input: true
      })
    })

    expect(computeFrustration([deadClick, errorClick], {})).toEqual({
      isRage: false
    })
    expect(deadClick.frustrations).toEqual([FrustrationType.DEAD_CLICK])
    expect(errorClick.frustrations).toEqual([FrustrationType.ERROR_CLICK])
  })

  it('should exclude interactive targets and associated labels from dead clicks', () => {
    const input = document.createElement('input')
    input.id = 'field-id'
    document.body.appendChild(input)

    const label = document.createElement('label')
    label.setAttribute('for', 'field-id')

    expect(
      isDead(
        createClick({
          event: { timeStamp: 0, target: input }
        })
      )
    ).toBeFalse()
    expect(
      isDead(
        createClick({
          event: { timeStamp: 0, target: label }
        })
      )
    ).toBeFalse()

    input.remove()
  })

  it('should not mark dead clicks when selection changes on a non-rage chain', () => {
    const click = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      },
      getUserActivity: () => ({
        selection: true,
        scroll: false,
        input: false
      })
    })

    expect(computeFrustration([click], {})).toEqual({ isRage: false })
    expect(click.frustrations).toEqual([])
  })

  it('should not consider a chain as rage when selection or scroll activity happened', () => {
    const clicks = [100, 200, 300].map((timeStamp) =>
      createClick({
        event: {
          timeStamp,
          target: document.createElement('div')
        },
        getUserActivity: () => ({
          selection: timeStamp === 100,
          scroll: false,
          input: false
        })
      })
    )

    expect(isRage(clicks)).toBeFalse()

    const scrollingClicks = [100, 200, 300].map((timeStamp) =>
      createClick({
        event: {
          timeStamp,
          target: document.createElement('div')
        },
        getUserActivity: () => ({
          selection: false,
          scroll: timeStamp === 200,
          input: false
        })
      })
    )

    expect(isRage(scrollingClicks)).toBeFalse()
  })

  it('should not consider clicks as dead when page activity or input activity happened', () => {
    const activeClick = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      },
      hasPageActivity: () => true
    })
    const inputClick = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      },
      getUserActivity: () => ({
        selection: false,
        scroll: false,
        input: true
      })
    })

    expect(isDead(activeClick)).toBeFalse()
    expect(isDead(inputClick)).toBeFalse()
  })
})
