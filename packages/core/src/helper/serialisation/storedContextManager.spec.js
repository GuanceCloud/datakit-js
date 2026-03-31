import { createContextManager } from './contextManager'
import {
  buildStorageKey,
  removeStorageListeners,
  storeContextManager
} from './storedContextManager'

describe('storedContextManager', () => {
  afterEach(() => {
    localStorage.clear()
    removeStorageListeners()
  })

  it('should build the storage key with and without a custom suffix', () => {
    expect(buildStorageKey({}, 'rum', 'user')).toBe('_gc_s_rum_user')
    expect(
      buildStorageKey({ storeContextsKey: 'tenant-a' }, 'rum', 'user')
    ).toBe('_gc_s_rum_user_tenant-a')
  })

  it('should initialize context from storage and keep existing values', () => {
    localStorage.setItem(
      '_gc_s_rum_user',
      JSON.stringify({ fromStorage: 'yes' })
    )
    const contextManager = createContextManager()

    contextManager.setContext({ fromMemory: 'yes' })

    storeContextManager({}, contextManager, 'rum', 'user')

    expect(contextManager.getContext()).toEqual({
      fromStorage: 'yes',
      fromMemory: 'yes'
    })
  })

  it('should persist changes to localStorage', () => {
    const contextManager = storeContextManager(
      {},
      createContextManager(),
      'rum',
      'user'
    )

    contextManager.setContext({ id: '123' })

    expect(JSON.parse(localStorage.getItem('_gc_s_rum_user'))).toEqual({
      id: '123'
    })
  })

  it('should synchronize context when a matching storage event is received', () => {
    const contextManager = storeContextManager(
      {},
      createContextManager(),
      'rum',
      'user'
    )

    localStorage.setItem('_gc_s_rum_user', JSON.stringify({ id: 'from-storage' }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '_gc_s_rum_user'
      })
    )

    expect(contextManager.getContext()).toEqual({
      id: 'from-storage'
    })
  })

  it('should ignore storage events for other keys', () => {
    const contextManager = storeContextManager(
      {},
      createContextManager(),
      'rum',
      'user'
    )

    contextManager.setContext({ id: 'initial' })
    localStorage.setItem('_gc_s_logs_user', JSON.stringify({ id: 'other' }))
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: '_gc_s_logs_user'
      })
    )

    expect(contextManager.getContext()).toEqual({
      id: 'initial'
    })
  })
})
