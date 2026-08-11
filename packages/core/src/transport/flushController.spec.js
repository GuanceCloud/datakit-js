import { Observable } from '../helper/observable'
import { createFlushController } from './flushController'

describe('flushController', () => {
  let pageExitObservable
  let sessionExpireObservable
  let flushController
  let flushSpy

  beforeEach(() => {
    jasmine.clock().install()

    pageExitObservable = new Observable()
    sessionExpireObservable = new Observable()
    flushController = createFlushController({
      messagesLimit: 2,
      bytesLimit: 10,
      durationLimit: 100,
      pageExitObservable,
      sessionExpireObservable
    })
    flushSpy = jasmine.createSpy('flushSpy')
    flushController.flushObservable.subscribe(flushSpy)
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should flush when the messages limit is reached', () => {
    flushController.notifyBeforeAddMessage(3)
    flushController.notifyAfterAddMessage()
    flushController.notifyBeforeAddMessage(4)
    flushController.notifyAfterAddMessage()

    expect(flushSpy).toHaveBeenCalledWith({
      reason: 'messages_limit',
      messagesCount: 2,
      bytesCount: 7
    })
    expect(flushController.getMessagesCount()).toBe(0)
  })

  it('should flush when the bytes limit is exceeded before adding a message', () => {
    flushController.notifyBeforeAddMessage(8)
    flushController.notifyBeforeAddMessage(3)

    expect(flushSpy).toHaveBeenCalledWith({
      reason: 'bytes_limit',
      messagesCount: 1,
      bytesCount: 8
    })
    expect(flushController.getMessagesCount()).toBe(1)
  })

  it('should flush when the duration limit is reached', () => {
    flushController.notifyBeforeAddMessage(3)

    jasmine.clock().tick(100)

    expect(flushSpy).toHaveBeenCalledWith({
      reason: 'duration_limit',
      messagesCount: 1,
      bytesCount: 3
    })
  })

  it('should flush on page exit and session expiration', () => {
    flushController.notifyBeforeAddMessage(3)
    pageExitObservable.notify({ reason: 'before_unload' })

    expect(flushSpy).toHaveBeenCalledWith({
      reason: 'before_unload',
      messagesCount: 1,
      bytesCount: 3
    })

    flushSpy.calls.reset()
    flushController.notifyBeforeAddMessage(2)
    sessionExpireObservable.notify()

    expect(flushSpy).toHaveBeenCalledWith({
      reason: 'session_expire',
      messagesCount: 1,
      bytesCount: 2
    })
  })

  it('should notify an empty current batch on page exit for async journal draining', () => {
    pageExitObservable.notify({ reason: 'before_unload' })

    expect(flushSpy).toHaveBeenCalledOnceWith({
      reason: 'before_unload',
      messagesCount: 0,
      bytesCount: 0
    })

    flushSpy.calls.reset()
    sessionExpireObservable.notify()
    expect(flushSpy).not.toHaveBeenCalled()
  })

  it('should cancel the duration timer when all messages are removed', () => {
    flushController.notifyBeforeAddMessage(3)
    flushController.notifyAfterRemoveMessage(3)

    jasmine.clock().tick(100)

    expect(flushSpy).not.toHaveBeenCalled()
    expect(flushController.getMessagesCount()).toBe(0)
  })
})
