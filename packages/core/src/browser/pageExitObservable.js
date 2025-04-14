import { Observable } from '../helper/observable'
import { includes, values } from '../helper/tools'
import { DOM_EVENT } from '../helper/enums'
import {
  addEventListener,
  addEventListeners
} from '../browser/addEventListener'
export var PageExitReason = {
  HIDDEN: 'visibility_hidden',
  UNLOADING: 'before_unload',
  PAGEHIDE: 'page_hide',
  FROZEN: 'page_frozen'
}

export function createPageExitObservable() {
  return new Observable(function (observable) {
    /**
     * Only event that guarantee to fire on mobile devices when the page transitions to background state
     * (e.g. when user switches to a different application, goes to homescreen, etc), or is being unloaded.
     */
    var visibilityChangeListener = addEventListeners(
      window,
      [DOM_EVENT.VISIBILITY_CHANGE, DOM_EVENT.FREEZE],
      function (event) {
        if (
          event.type === DOM_EVENT.VISIBILITY_CHANGE &&
          document.visibilityState === 'hidden'
        ) {
          /**
           * Only event that guarantee to fire on mobile devices when the page transitions to background state
           * (e.g. when user switches to a different application, goes to homescreen, etc), or is being unloaded.
           */
          observable.notify({ reason: PageExitReason.HIDDEN })
        } else if (event.type === DOM_EVENT.FREEZE) {
          /**
           * After transitioning in background a tab can be freezed to preserve resources. (cf: https://developer.chrome.com/blog/page-lifecycle-api)
           * Allow to collect events happening between hidden and frozen state.
           */
          observable.notify({ reason: PageExitReason.FROZEN })
        }
      },
      { capture: true }
    )

    /**
     * Safari does not support yet to send a request during:
     * - a visibility change during doc unload (cf: https://bugs.webkit.org/show_bug.cgi?id=194897)
     * - a page hide transition (cf: https://bugs.webkit.org/show_bug.cgi?id=188329)
     */
    var beforeUnloadListener = addEventListener(
      window,
      DOM_EVENT.BEFORE_UNLOAD,
      function () {
        observable.notify({ reason: PageExitReason.UNLOADING })
      }
    )

    return function () {
      visibilityChangeListener.stop()
      beforeUnloadListener.stop()
    }
  })
}

export function isPageExitReason(reason) {
  return includes(values(PageExitReason), reason)
}
