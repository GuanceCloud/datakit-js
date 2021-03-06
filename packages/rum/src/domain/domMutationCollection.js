import { LifeCycleEventType } from '@cloudcare/browser-core'

function getMutationObserverConstructor() {
  var constructor
  var browserWindow = window

  // Angular uses Zone.js to provide a context persisting accross async tasks.  Zone.js replaces the
  // global MutationObserver constructor with a patched version to support the context propagation.
  // There is an ongoing issue[1][2] with this setup when using a MutationObserver within a Angular
  // component: on some occasions, the callback is being called in an infinite loop, causing the
  // page to freeze (even if the callback is completely empty).
  //
  // To work around this issue, we are using the Zone __symbol__ API to get the original, unpatched
  // MutationObserver constructor.
  //
  // [1] https://github.com/angular/angular/issues/26948
  // [2] https://github.com/angular/angular/issues/31712
  if (browserWindow.Zone) {
    var symbol = browserWindow.Zone.__symbol__('MutationObserver')
    constructor = browserWindow[symbol]
  }

  if (!constructor) {
    constructor = browserWindow.MutationObserver
  }

  return constructor
}

export function startDOMMutationCollection(lifeCycle) {
  var observer
  var MutationObserver = getMutationObserverConstructor()
  if (MutationObserver) {
    observer = new MutationObserver(function () {
      lifeCycle.notify(LifeCycleEventType.DOM_MUTATED)
    })

    observer.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    })
  }

  return {
    stop: function () {
      if (observer) {
        observer.disconnect()
      }
    }
  }
}
