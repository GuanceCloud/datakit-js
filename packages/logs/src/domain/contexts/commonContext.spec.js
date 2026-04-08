import { buildCommonContext } from './commonContext'

describe('logs/commonContext', () => {
  it('should combine view, global context and user context', () => {
    const globalContextManager = {
      getContext: jasmine.createSpy('getContext').and.returnValue({
        env: 'prod'
      })
    }
    const userContextManager = {
      getContext: jasmine.createSpy('getContext').and.returnValue({
        id: 'user-1'
      })
    }

    expect(buildCommonContext(globalContextManager, userContextManager)).toEqual({
      view: {
        referrer: document.referrer,
        url: window.location.href
      },
      context: {
        env: 'prod'
      },
      user: {
        id: 'user-1'
      }
    })
  })
})
