import { initConsoleObservable, ConsoleApiName } from '@cloudcare/browser-core'

export function trackConsoleError(errorObservable) {
  var subscription = initConsoleObservable([ConsoleApiName.error]).subscribe(
    function (consoleLog) {
      errorObservable.notify(consoleLog.error)
    }
  )

  return {
    stop: function () {
      subscription.unsubscribe()
    }
  }
}
