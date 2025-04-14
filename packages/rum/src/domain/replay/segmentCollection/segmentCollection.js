import {
  ONE_SECOND,
  LifeCycleEventType,
  isPageExitReason,
  setTimeout,
  clearTimeout
} from '@cloudcare/browser-core'
import { buildReplayPayload } from './buildReplayPayload'
import { createSegment } from './segment'

export var SEGMENT_DURATION_LIMIT = 5 * ONE_SECOND
/**
 * beacon payload max queue size implementation is 64kb
 * ensure that we leave room for logs, rum and potential other users
 */
export var SEGMENT_BYTES_LIMIT = 60000

// Segments are the main data structure for session replays. They contain context information used
// for indexing or UI needs, and a list of records (RRWeb 'events', renamed to avoid confusing
// namings). They are stored without any processing from the intake, and fetched one after the
// other while a session is being replayed. Their encoding (deflate) are carefully crafted to allow
// concatenating multiple segments together. Segments have a size overhead (metadata), so our goal is to
// build segments containing as many records as possible while complying with the various flush
// strategies to guarantee a good replay quality.
//
// When the recording starts, a segment is initially created.  The segment is flushed (finalized and
// sent) based on various events (non-exhaustive list):
//
// * the page visibility change or becomes to unload
// * the segment duration reaches a limit
// * the encoded segment bytes count reaches a limit
// * ...
//
// A segment cannot be created without its context.  If the RUM session ends and no session id is
// available when creating a new segment, records will be ignored, until the session is renewed and
// a new session id is available.
//
// Empty segments (segments with no record) aren't useful and should be ignored.
//
// To help investigate session replays issues, each segment is created with a "creation reason",
// indicating why the session has been created.

export function startSegmentCollection(
  lifeCycle,
  configuration,
  sessionManager,
  viewContexts,
  httpRequest,
  encoder,
  isLocked = false
) {
  return doStartSegmentCollection(
    lifeCycle,
    function () {
      return computeSegmentContext(configuration, sessionManager, viewContexts)
    },
    httpRequest,
    encoder,
    isLocked
  )
}

var SegmentCollectionStatus = {
  WaitingForInitialRecord: 0,
  SegmentPending: 1,
  Stopped: 2
}

export function doStartSegmentCollection(
  lifeCycle,
  getSegmentContext,
  httpRequest,
  encoder,
  isLocked
) {
  var state = {
    status: SegmentCollectionStatus.WaitingForInitialRecord,
    nextSegmentCreationReason: 'init',
    isLocked: isLocked
  }
  var subscribeViewCreated = lifeCycle.subscribe(
    LifeCycleEventType.VIEW_CREATED,
    function () {
      flushSegment('view_change')
    }
  )
  var unsubscribeViewCreated = subscribeViewCreated.unsubscribe
  var subscribePageExited = lifeCycle.subscribe(
    LifeCycleEventType.PAGE_EXITED,
    function (pageExitEvent) {
      flushSegment(pageExitEvent.reason)
    }
  )
  var unsubscribePageExited = subscribePageExited.unsubscribe
  const lockedFlushReason = ['view_change', 'buffer_checkout']
  function flushSegment(flushReason, callback) {
    const isLocked = state.isLocked
    if (state.status === SegmentCollectionStatus.SegmentPending) {
      if (isLocked && lockedFlushReason.includes(flushReason)) {
        state.segment.flush(() => {
          if (callback) callback()
        })
      } else {
        // if the segment is locked, we don't send it
        if (isLocked) {
          return
        }
        state.segment.flush(function (metadata, encoderResult) {
          var payload = buildReplayPayload(
            encoderResult.output,
            metadata,
            encoderResult.rawBytesCount
          )

          if (isPageExitReason(flushReason)) {
            httpRequest.sendOnExit(payload)
          } else {
            httpRequest.send(payload)
          }
        })
      }
      clearTimeout(state.expirationTimeoutId)
    }

    if (flushReason !== 'stop') {
      state = {
        status: SegmentCollectionStatus.WaitingForInitialRecord,
        nextSegmentCreationReason: flushReason,
        isLocked: state.isLocked
      }
    } else {
      state = {
        status: SegmentCollectionStatus.Stopped,
        isLocked: false
      }
    }
  }

  return {
    addRecord: function (record) {
      if (state.status === SegmentCollectionStatus.Stopped) {
        return
      }

      if (state.status === SegmentCollectionStatus.WaitingForInitialRecord) {
        var context = getSegmentContext()
        if (!context) {
          return
        }

        state = {
          status: SegmentCollectionStatus.SegmentPending,
          segment: createSegment({
            encoder: encoder,
            context: context,
            creationReason: state.nextSegmentCreationReason
          }),
          isLocked: state.isLocked,
          expirationTimeoutId: setTimeout(function () {
            flushSegment('segment_duration_limit')
          }, SEGMENT_DURATION_LIMIT)
        }
      }

      state.segment.addRecord(record, function (encodedBytesCount) {
        if (encodedBytesCount > SEGMENT_BYTES_LIMIT) {
          flushSegment('segment_bytes_limit')
        }
      })
    },

    unlockSegment: function () {
      state.isLocked = false
    },
    flushBufferSegment: function (callback) {
      flushSegment('buffer_checkout', callback)
    },
    isLocked: function () {
      return state.isLocked
    },
    stop: function () {
      flushSegment('stop')
      unsubscribeViewCreated()
      unsubscribePageExited()
    }
  }
}

export function computeSegmentContext(
  configuration,
  sessionManager,
  viewContexts
) {
  var session = sessionManager.findTrackedSession()
  var viewContext = viewContexts.findView()
  if (!session || !viewContext) {
    return undefined
  }
  return {
    sdk: {
      name: configuration.sdkName,
      version: configuration.sdkVersion
    },
    env: configuration.env || '',
    service: viewContext.service || configuration.service || 'browser',
    version: viewContext.version || configuration.version || '',
    app: {
      id: configuration.applicationId
    },
    session: {
      id: session.id
    },
    view: {
      id: viewContext.id
    }
  }
}

export function setSegmentBytesLimit(newSegmentBytesLimit = 60_000) {
  SEGMENT_BYTES_LIMIT = newSegmentBytesLimit
}
