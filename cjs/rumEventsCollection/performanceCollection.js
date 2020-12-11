"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.supportPerformanceTimingEvent = supportPerformanceTimingEvent;
exports.startPerformanceCollection = startPerformanceCollection;
exports.retrieveInitialDocumentResourceTiming = retrieveInitialDocumentResourceTiming;

var _tools = require("../helper/tools");

var _enums = require("../helper/enums");

var _lifeCycle = require("../helper/lifeCycle");

var _resourceUtils = require("./resource/resourceUtils");

function supportPerformanceObject() {
  return window.performance !== undefined && 'getEntries' in performance;
}

function supportPerformanceTimingEvent(entryType) {
  return window.PerformanceObserver && PerformanceObserver.supportedEntryTypes !== undefined && (0, _tools.includes)(PerformanceObserver.supportedEntryTypes, entryType);
}

function startPerformanceCollection(lifeCycle, configuration) {
  retrieveInitialDocumentResourceTiming(function (timing) {
    handleRumPerformanceEntry(lifeCycle, configuration, timing);
  });

  if (supportPerformanceObject()) {
    handlePerformanceEntries(lifeCycle, configuration, performance.getEntries());
  }

  if (window.PerformanceObserver) {
    var observer = new PerformanceObserver(function (entries) {
      handlePerformanceEntries(lifeCycle, configuration, entries.getEntries());
    });
    var entryTypes = ['resource', 'navigation', 'longtask', 'paint', 'largest-contentful-paint', // 'first-input',
    'layout-shift'];
    observer.observe({
      entryTypes: entryTypes
    });

    if (supportPerformanceObject() && 'addEventListener' in performance) {
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1559377
      performance.addEventListener('resourcetimingbufferfull', function () {
        performance.clearResourceTimings();
      });
    }
  }

  if (!supportPerformanceTimingEvent('navigation')) {
    retrieveNavigationTiming(function (timing) {
      handleRumPerformanceEntry(lifeCycle, configuration, timing);
    });
  } // if (!supportPerformanceTimingEvent('first-input')) {
  //   retrieveFirstInputTiming((timing) => {
  //     handleRumPerformanceEntry(lifeCycle, configuration, timing)
  //   })
  // }

}

function retrieveInitialDocumentResourceTiming(callback) {
  runOnReadyState('interactive', function () {
    var timing;
    var forcedAttributes = {
      entryType: 'resource',
      initiatorType: _resourceUtils.FAKE_INITIAL_DOCUMENT,
      traceId: ''
    };

    if (supportPerformanceTimingEvent('navigation') && performance.getEntriesByType('navigation').length > 0) {
      var navigationEntry = performance.getEntriesByType('navigation')[0];
      timing = (0, _tools.extend)(navigationEntry.toJSON(), forcedAttributes);
    } else {
      var relativePerformanceTiming = computeRelativePerformanceTiming();
      timing = (0, _tools.extend)(relativePerformanceTiming, {
        decodedBodySize: 0,
        duration: relativePerformanceTiming.responseEnd,
        name: window.location.href,
        startTime: 0
      }, forcedAttributes);
    }

    callback(timing);
  });
}

function retrieveNavigationTiming(callback) {
  function sendFakeTiming() {
    callback((0, _tools.extend)(computeRelativePerformanceTiming(), {
      entryType: 'navigation'
    }));
  }

  runOnReadyState('complete', function () {
    // Send it a bit after the actual load event, so the "loadEventEnd" timing is accurate
    setTimeout(sendFakeTiming);
  });
}
/**
 * first-input timing entry polyfill based on
 * https://github.com/GoogleChrome/web-vitals/blob/master/src/lib/polyfills/firstInputPolyfill.ts
 */


function retrieveFirstInputTiming(callback) {
  var startTimeStamp = Date.now();
  var timingSent = false;
  var listeners = (0, _tools.addEventListeners)(window, [_enums.DOM_EVENT.CLICK, _enums.DOM_EVENT.MOUSE_DOWN, _enums.DOM_EVENT.KEY_DOWN, _enums.DOM_EVENT.TOUCH_START, _enums.DOM_EVENT.POINTER_DOWN], function (evt) {
    // Only count cancelable events, which should trigger behavior important to the user.
    if (!evt.cancelable) {
      return;
    } // This timing will be used to compute the "first Input delay", which is the delta between
    // when the system received the event (e.g. evt.timeStamp) and when it could run the callback
    // (e.g. performance.now()).


    var timing = {
      entryType: 'first-input',
      processingStart: performance.now(),
      startTime: evt.timeStamp
    };

    if (evt.type === _enums.DOM_EVENT.POINTER_DOWN) {
      sendTimingIfPointerIsNotCancelled(timing);
    } else {
      sendTiming(timing);
    }
  }, {
    passive: true,
    capture: true
  });
  var removeEventListeners = listeners.stop;
  /**
   * Pointer events are a special case, because they can trigger main or compositor thread behavior.
   * We differenciate these cases based on whether or not we see a pointercancel event, which are
   * fired when we scroll. If we're scrolling we don't need to report input delay since FID excludes
   * scrolling and pinch/zooming.
   */

  function sendTimingIfPointerIsNotCancelled(timing) {
    (0, _tools.addEventListeners)(window, [_enums.DOM_EVENT.POINTER_UP, _enums.DOM_EVENT.POINTER_CANCEL], function (event) {
      if (event.type === _enums.DOM_EVENT.POINTER_UP) {
        sendTiming(timing);
      }
    }, {
      once: true
    });
  }

  function sendTiming(timing) {
    if (!timingSent) {
      timingSent = true;
      removeEventListeners(); // In some cases the recorded delay is clearly wrong, e.g. it's negative or it's larger than
      // the time between now and when the page was loaded.
      // - https://github.com/GoogleChromeLabs/first-input-delay/issues/4
      // - https://github.com/GoogleChromeLabs/first-input-delay/issues/6
      // - https://github.com/GoogleChromeLabs/first-input-delay/issues/7

      var delay = timing.processingStart - timing.startTime;

      if (delay >= 0 && delay < Date.now() - startTimeStamp) {
        callback(timing);
      }
    }
  }
}

function runOnReadyState(expectedReadyState, callback) {
  if (document.readyState === expectedReadyState || document.readyState === 'complete') {
    callback();
  } else {
    var eventName = expectedReadyState === 'complete' ? _enums.DOM_EVENT.LOAD : _enums.DOM_EVENT.DOM_CONTENT_LOADED;
    (0, _tools.addEventListener)(window, eventName, callback, {
      once: true
    });
  }
}

function computeRelativePerformanceTiming() {
  var result = {};
  var timing = performance.timing;

  for (var key in timing) {
    if ((0, _tools.isNumber)(timing[key])) {
      result[key] = timing[key] === 0 ? 0 : (0, _tools.getRelativeTime)(timing[key]);
    }
  }

  return result;
}

function handlePerformanceEntries(lifeCycle, configuration, entries) {
  (0, _tools.each)(entries, function (entry) {
    if (entry.entryType === 'resource' || entry.entryType === 'navigation' || entry.entryType === 'paint' || entry.entryType === 'longtask' || entry.entryType === 'largest-contentful-paint' || // entry.entryType === 'first-input' ||
    entry.entryType === 'layout-shift') {
      handleRumPerformanceEntry(lifeCycle, configuration, entry);
    }
  });
}

function handleRumPerformanceEntry(lifeCycle, configuration, entry) {
  if (isIncompleteNavigation(entry) || isForbiddenResource(configuration, entry)) {
    return;
  }

  lifeCycle.notify(_lifeCycle.LifeCycleEventType.PERFORMANCE_ENTRY_COLLECTED, entry);
}

function isIncompleteNavigation(entry) {
  return entry.entryType === 'navigation' && entry.loadEventEnd <= 0;
}

function isForbiddenResource(configuration, entry) {
  return entry.entryType === 'resource' && !(0, _resourceUtils.isAllowedRequestUrl)(configuration, entry.name);
}