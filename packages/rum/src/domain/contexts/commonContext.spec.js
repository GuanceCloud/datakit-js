import { buildCommonContext } from './commonContext'

describe('commonContext', () => {
  it('should combine global, user and replay context', () => {
    const context = buildCommonContext(
      {
        getContext: () => ({ env: 'test' })
      },
      {
        getContext: () => ({ id: 'user-1' })
      },
      {
        isRecording: () => true
      }
    )

    expect(context).toEqual({
      context: { env: 'test' },
      user: { id: 'user-1' },
      hasReplay: true
    })
  })

  it('should omit hasReplay when the recorder is idle', () => {
    const context = buildCommonContext(
      {
        getContext: () => ({})
      },
      {
        getContext: () => ({})
      },
      {
        isRecording: () => false
      }
    )

    expect(context.hasReplay).toBeUndefined()
  })
})
