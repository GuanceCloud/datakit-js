import { IncrementalSource, RecordType } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import { record } from './record'

describe('replay/record/record', () => {
  let container

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (container) {
      container.remove()
    }
  })

  it('should require an emit function', () => {
    expect(() => record({ configuration: {}, lifeCycle: {} })).toThrowError(
      'emit function is required'
    )
  })

  it('should emit initial snapshots, input updates and subsequent full snapshots', () => {
    const input = document.createElement('input')
    input.value = 'initial'
    container.appendChild(input)

    const emittedRecords = []
    const recorder = record({
      emit: (record) => {
        emittedRecords.push(record)
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      lifeCycle: {
        subscribe() {
          return {
            unsubscribe: jasmine.createSpy('unsubscribe')
          }
        }
      }
    })

    const initialTypes = emittedRecords.map((event) => event.type)
    expect(initialTypes).toContain(RecordType.Meta)
    expect(initialTypes).toContain(RecordType.Focus)
    expect(initialTypes).toContain(RecordType.FullSnapshot)

    const initialFullSnapshot = emittedRecords.find(
      (event) => event.type === RecordType.FullSnapshot
    )
    expect(initialFullSnapshot).toEqual(
      jasmine.objectContaining({
        timestamp: jasmine.any(Number),
        data: jasmine.objectContaining({
          node: jasmine.any(Object),
          initialOffset: jasmine.any(Object)
        })
      })
    )

    input.value = 'changed'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const inputSnapshot = emittedRecords.find(
      (event) =>
        event.type === RecordType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input
    )
    expect(inputSnapshot).toEqual(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          source: IncrementalSource.Input,
          text: 'changed',
          id: jasmine.any(Number)
        })
      })
    )

    recorder.takeSubsequentFullSnapshot(1234)

    const subsequentSnapshotEvents = emittedRecords.filter(
      (event) =>
        event.timestamp === 1234 &&
        (event.type === RecordType.Meta ||
          event.type === RecordType.Focus ||
          event.type === RecordType.FullSnapshot)
    )
    expect(subsequentSnapshotEvents.length).toBe(3)

    expect(() => recorder.flushMutations()).not.toThrow()
    expect(() => recorder.stop()).not.toThrow()
  })
})
