import { createValueHistory } from './valueHistory'

describe('createValueHistory', () => {
  let valueHistory

  beforeEach(() => {
    valueHistory = createValueHistory({ expireDelay: 100, maxEntries: 2 })
  })

  afterEach(() => {
    valueHistory.stop()
  })

  it('should return the active value for a given time', () => {
    valueHistory.add('first', 10).close(20)
    valueHistory.add('second', 21)

    expect(valueHistory.find(15)).toBe('first')
    expect(valueHistory.find(25)).toBe('second')
  })

  it('should not return inactive values by default', () => {
    valueHistory.add('value', 10).close(20)

    expect(valueHistory.find(25)).toBeUndefined()
    expect(valueHistory.find(25, { returnInactive: true })).toBe('value')
  })

  it('should close the latest active entry', () => {
    valueHistory.add('first', 10)
    valueHistory.add('second', 20)

    valueHistory.closeActive(30)

    expect(valueHistory.find(35)).toBeUndefined()
    expect(valueHistory.find(35, { returnInactive: true })).toBe('second')
  })

  it('should return all overlapping values in reverse chronological order', () => {
    const fullHistory = createValueHistory({ expireDelay: 100, maxEntries: 10 })

    fullHistory.add('first', 10).close(20)
    fullHistory.add('second', 21).close(35)
    fullHistory.add('third', 36)

    expect(fullHistory.findAll(18, 20)).toEqual(['third', 'second', 'first'])

    fullHistory.stop()
  })

  it('should enforce the max entries limit', () => {
    valueHistory.add('first', 10)
    valueHistory.add('second', 20)
    valueHistory.add('third', 30)

    expect(valueHistory.findAll()).toEqual(['third', 'second'])
  })

  it('should reset the history', () => {
    valueHistory.add('value', 10)

    valueHistory.reset()

    expect(valueHistory.find()).toBeUndefined()
    expect(valueHistory.findAll()).toEqual([])
  })
})
