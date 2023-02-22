import { DOM_EVENT } from '@cloudcare/browser-core'
import { startMutationObserver } from './mutationObserver'
import { initInputObserver } from './observers'

export var initShadowRootsController = function (configuration, data) {
  var mutationCb = data.mutationCb
  var inputCb = data.inputCb
  var controllerByShadowRoot = new Map()

  var shadowRootsController = {
    addShadowRoot: function (shadowRoot) {
      var _startMutaionObserve = startMutationObserver(
        mutationCb,
        configuration,
        shadowRootsController,
        shadowRoot
      )
      var flush = _startMutaionObserve.flush
      var stopMutationObserver = _startMutaionObserve.stop

      // the change event no do bubble up across the shadow root, we have to listen on the shadow root
      var stopInputObserver = initInputObserver(
        inputCb,
        configuration.defaultPrivacyLevel,
        {
          target: shadowRoot,
          domEvents: [DOM_EVENT.CHANGE]
        }
      )
      controllerByShadowRoot.set(shadowRoot, {
        flush: flush,
        stop: function () {
          stopMutationObserver()
          stopInputObserver()
        }
      })
    },
    removeShadowRoot: function (shadowRoot) {
      var entry = controllerByShadowRoot.get(shadowRoot)
      if (!entry) {
        return
      }
      entry.stop()
      controllerByShadowRoot.delete(shadowRoot)
    },
    stop: function () {
      controllerByShadowRoot.forEach(function (event) {
        event.stop()
      })
    },
    flush: function () {
      controllerByShadowRoot.forEach(function (event) {
        event.flush()
      })
    }
  }
  return shadowRootsController
}
