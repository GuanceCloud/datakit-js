import { limitModification } from './limitModification'

describe('limitModification', () => {
  it('should only persist changes on allowed field paths', () => {
    const original = {
      allowed: 'before',
      blocked: 'keep',
      nested: {
        allowed: { value: 'before' },
        blocked: { value: 'keep' }
      }
    }

    const result = limitModification(
      original,
      {
        allowed: 'string',
        'nested.allowed': 'object'
      },
      (clone) => {
        clone.allowed = 'after'
        clone.blocked = 'changed'
        clone.nested.allowed = { value: 'after' }
        clone.nested.blocked = { value: 'changed' }
        return 'modifier-result'
      }
    )

    expect(result).toBe('modifier-result')
    expect(original).toEqual({
      allowed: 'after',
      blocked: 'keep',
      nested: {
        allowed: { value: 'after' },
        blocked: { value: 'keep' }
      }
    })
  })

  it('should sanitize values written back to the original object', () => {
    const original = {
      metadata: {}
    }
    const unsafeValue = {}
    unsafeValue.self = unsafeValue

    limitModification(original, { metadata: 'object' }, (clone) => {
      clone.metadata = unsafeValue
    })

    expect(original.metadata).toEqual({
      self: '[Reference seen at $]'
    })
  })

  it('should initialize object fields when the modifier sets them to null or undefined', () => {
    const original = {
      metadata: { existing: true }
    }

    limitModification(original, { metadata: 'object' }, (clone) => {
      clone.metadata = undefined
    })
    expect(original.metadata).toEqual({})

    limitModification(original, { metadata: 'object' }, (clone) => {
      clone.metadata = null
    })
    expect(original.metadata).toEqual({})
  })

  it('should apply allowed changes on array items', () => {
    const original = {
      items: [{ name: 'first' }, { name: 'second' }]
    }

    limitModification(original, { 'items.[].name': 'string' }, (clone) => {
      clone.items[0].name = 'updated-first'
      clone.items[1].name = 'updated-second'
    })

    expect(original.items).toEqual([
      { name: 'updated-first' },
      { name: 'updated-second' }
    ])
  })
})
