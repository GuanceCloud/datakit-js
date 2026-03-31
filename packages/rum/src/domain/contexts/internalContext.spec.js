import { startInternalContext } from './internalContext'

describe('internalContext', () => {
  it('should build the legacy internal context when all pieces are available', () => {
    const internalContext = startInternalContext(
      'app-1',
      {
        findTrackedSession: () => ({ id: 'session-1' })
      },
      {
        findView: () => ({ id: 'view-1', name: 'Checkout' })
      },
      {
        findActionId: () => 'action-1',
        findAllActionId: () => ['action-1', 'action-2']
      },
      {
        findUrl: () => ({
          url: 'https://example.com/checkout?id=1',
          referrer: 'https://example.com/cart',
          host: 'example.com',
          path: '/checkout',
          pathGroup: '/checkout',
          pathname: '/checkout',
          urlQuery: { id: '1' }
        })
      }
    )

    expect(internalContext.get(123)).toEqual({
      application: { id: 'app-1' },
      session: { id: 'session-1' },
      userAction: { id: 'action-1', ids: ['action-1', 'action-2'] },
      view: {
        id: 'view-1',
        name: 'Checkout',
        url: 'https://example.com/checkout?id=1',
        referrer: 'https://example.com/cart',
        host: 'example.com',
        path: '/checkout',
        pathGroup: '/checkout',
        pathname: '/checkout',
        urlQuery: { id: '1' }
      }
    })
  })

  it('should fallback view name to url path and omit user action when absent', () => {
    const internalContext = startInternalContext(
      'app-1',
      {
        findTrackedSession: () => ({ id: 'session-1' })
      },
      {
        findView: () => ({ id: 'view-1' })
      },
      {
        findActionId: () => undefined,
        findAllActionId: () => []
      },
      {
        findUrl: () => ({
          url: 'https://example.com/orders/42',
          referrer: '',
          host: 'example.com',
          path: '/orders/?',
          pathGroup: '/orders/?',
          pathname: '/orders/42',
          urlQuery: {}
        })
      }
    )

    expect(internalContext.get(123)).toEqual(
      jasmine.objectContaining({
        view: jasmine.objectContaining({
          name: '/orders/?'
        }),
        userAction: undefined
      })
    )
  })

  it('should return undefined when session, view or url context is missing', () => {
    const internalContext = startInternalContext(
      'app-1',
      {
        findTrackedSession: () => undefined
      },
      {
        findView: () => ({ id: 'view-1' })
      },
      {
        findActionId: () => undefined,
        findAllActionId: () => []
      },
      {
        findUrl: () => ({
          path: '/home'
        })
      }
    )

    expect(internalContext.get(123)).toBeUndefined()
  })
})
