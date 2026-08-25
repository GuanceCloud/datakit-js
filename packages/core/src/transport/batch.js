import { display } from '../helper/display'
import {
  values,
  findByPath,
  each,
  isNumber,
  isArray,
  extend,
  isString,
  isEmptyObject,
  isObject
} from '../helper/tools'
import {
  escapeJsonValue,
  escapeRowField,
  escapeRowData
} from '../helper/serialisation/rowData'
import { commonTags, dataMap, commonFields } from '../dataMap'
import { RumEventType } from '../helper/enums'
import { computeBytesCount } from '../helper/byteUtils'
import { isPageExitReason } from '../browser/pageExitObservable'
import { jsonStringify } from '../helper/serialisation/jsonStringify'
// https://en.wikipedia.org/wiki/UTF-8
// eslint-disable-next-line no-control-regex
var CUSTOM_KEYS = 'custom_keys'
export var MAX_PENDING_RAW_JOURNAL_BYTES_COUNT = 4 * 1024 * 1024
export var processedMessageByDataMap = function (message) {
  if (!message || !message.type)
    return {
      rowStr: '',
      rowData: undefined
    }

  var rowData = { tags: {}, fields: {} }
  var hasFileds = false
  var rowStr = ''
  each(dataMap, function (value, key) {
    if (value.type === message.type) {
      rowStr += key + ','
      rowData.measurement = key
      var tagsStr = []
      var tags = extend({}, commonTags, value.tags)
      var filterFileds = ['date', 'type', CUSTOM_KEYS]
      each(tags, function (value_path, _key) {
        var _value = findByPath(message, value_path)
        filterFileds.push(_key)
        if (_value || isNumber(_value)) {
          rowData.tags[_key] = escapeJsonValue(_value, true)
          tagsStr.push(escapeRowData(_key) + '=' + escapeRowData(_value))
        }
      })

      var fieldsStr = []
      var fields = extend({}, commonFields, value.fields)
      each(fields, function (_value, _key) {
        if (isArray(_value) && _value.length === 2) {
          var value_path = _value[1]
          var _valueData = findByPath(message, value_path)
          filterFileds.push(_key)
          if (_valueData !== undefined && _valueData !== null) {
            rowData.fields[_key] = escapeJsonValue(_valueData)
            fieldsStr.push(
              escapeRowData(_key) + '=' + escapeRowField(_valueData)
            )
          }
        } else if (isString(_value)) {
          var _valueData = findByPath(message, _value)
          filterFileds.push(_key)
          if (_valueData !== undefined && _valueData !== null) {
            rowData.fields[_key] = escapeJsonValue(_valueData)
            fieldsStr.push(
              escapeRowData(_key) + '=' + escapeRowField(_valueData)
            )
          }
        }
      })
      if (
        message.context &&
        isObject(message.context) &&
        !isEmptyObject(message.context)
      ) {
        var _tagKeys = []
        each(message.context, function (_value, _key) {
          if (filterFileds.indexOf(_key) > -1) return
          filterFileds.push(_key)
          if (_value !== undefined && _value !== null) {
            _tagKeys.push(_key)
            rowData.fields[_key] = escapeJsonValue(_value)
            fieldsStr.push(escapeRowData(_key) + '=' + escapeRowField(_value))
          }
        })
        if (_tagKeys.length) {
          rowData.fields[CUSTOM_KEYS] = escapeJsonValue(_tagKeys)
          fieldsStr.push(
            escapeRowData(CUSTOM_KEYS) + '=' + escapeRowField(_tagKeys)
          )
        }
      }
      if (message.type === RumEventType.LOGGER) {
        each(message, function (value, key) {
          if (
            filterFileds.indexOf(key) === -1 &&
            value !== undefined &&
            value !== null
          ) {
            rowData.fields[key] = escapeJsonValue(value)
            fieldsStr.push(escapeRowData(key) + '=' + escapeRowField(value))
          }
        })
      }
      if (tagsStr.length) {
        rowStr += tagsStr.join(',')
      }
      if (fieldsStr.length) {
        rowStr += ' '
        rowStr += fieldsStr.join(',')
        hasFileds = true
      }
      rowStr = rowStr + ' ' + message.date
      rowData.time = message.date
    }
  })
  return {
    rowStr: hasFileds ? rowStr : '',
    rowData: hasFileds ? rowData : undefined
  }
}

export function createBatch(options) {
  var encoder = options.encoder
  var encoderFallback = options.encoderFallback
  var request = options.request
  var bytesLimit = options.bytesLimit
  var messageBytesLimit = options.messageBytesLimit
  var sendContentTypeByJson = options.sendContentTypeByJson
  var flushController = options.flushController
  var upsertBuffer = {}
  var upsertMessageBytesCountByKey = {}
  var upsertRawBytesCountByKey = {}
  var upsertRawBytesCount = 0
  var fallbackMessagesBuffer = []
  var fallbackMessagesBufferBytesCount = 0
  var rawFallbackBatchActive = false
  var pendingRawBatches = []
  var pendingRawBatchesBytesCount = 0
  var maxPendingRawBytes =
    typeof options.maxPendingRawBytes === 'number'
      ? options.maxPendingRawBytes
      : MAX_PENDING_RAW_JOURNAL_BYTES_COUNT
  var rawJournalLimitReported = false
  var currentBatchGeneration = 0
  var flushSubscription = flushController.flushObservable.subscribe(function (
    event
  ) {
    flush(event)
  })
  function getMessageText(messages, isEmpty = false) {
    if (sendContentTypeByJson) {
      if (isEmpty) {
        return '[' + messages.join(',')
      } else {
        return ',' + messages.join(',')
      }
    } else {
      if (isEmpty) {
        return messages.join('\n')
      } else {
        return '\n' + messages.join('\n')
      }
    }
  }
  function push(serializedMessage, estimatedMessageBytesCount, key) {
    flushController.notifyBeforeAddMessage(estimatedMessageBytesCount)

    var rawMessageBytesCount = computeBytesCount(serializedMessage) + 1
    if (
      encoder.isAsync &&
      encoderFallback &&
      pendingRawBatchesBytesCount +
        fallbackMessagesBufferBytesCount +
        upsertRawBytesCount +
        rawMessageBytesCount >
        maxPendingRawBytes
    ) {
      if (!rawJournalLimitReported) {
        rawJournalLimitReported = true
        display.warn(
          'Session data compression was disabled because its pending raw journal reached the safety limit.'
        )
      }
      // Preserve the older batches from the raw journal before retiring the
      // worker encoder. New messages continue through the identity encoder,
      // so the journal cannot keep growing behind a slow worker.
      switchToFallbackEncoder(encoder, true)
    }

    if (key !== undefined) {
      upsertBuffer[key] = serializedMessage
      upsertMessageBytesCountByKey[key] = estimatedMessageBytesCount
      upsertRawBytesCountByKey[key] = rawMessageBytesCount
      upsertRawBytesCount += rawMessageBytesCount
      flushController.notifyAfterAddMessage()
    } else {
      if (
        encoder.isAsync ||
        encoderFallback ||
        rawFallbackBatchActive
      ) {
        fallbackMessagesBuffer.push(serializedMessage)
        fallbackMessagesBufferBytesCount += rawMessageBytesCount
      }
      var writeEncoder = encoder
      var writeBatchGeneration = currentBatchGeneration
      writeEncoder.write(
        getMessageText([serializedMessage], writeEncoder.isEmpty()),
        function (realMessageBytesCount, error) {
          if (writeBatchGeneration === currentBatchGeneration) {
            flushController.notifyAfterAddMessage(
              error
                ? undefined
                : realMessageBytesCount - estimatedMessageBytesCount
            )
          }
          if (error) {
            // A stream-scoped worker error may recover before finish(). Switch
            // immediately so a later successful compressed chunk cannot hide
            // the loss of messages written before the error.
            switchToFallbackEncoder(writeEncoder)
          }
        }
      )
    }
  }

  function hasMessageFor(key) {
    return key !== undefined && upsertBuffer[key] !== undefined
  }

  function remove(key, keepDurationLimitTimeout) {
    delete upsertBuffer[key]
    var messageBytesCount = upsertMessageBytesCountByKey[key]
    delete upsertMessageBytesCountByKey[key]
    upsertRawBytesCount -= upsertRawBytesCountByKey[key] || 0
    delete upsertRawBytesCountByKey[key]
    flushController.notifyAfterRemoveMessage(
      messageBytesCount,
      keepDurationLimitTimeout
    )
  }
  function process(message) {
    var processedMessage = ''
    if (sendContentTypeByJson) {
      processedMessage = jsonStringify(
        processedMessageByDataMap(message).rowData
      )
    } else {
      processedMessage = processedMessageByDataMap(message).rowStr
    }
    return processedMessage
  }
  function addOrUpdate(message, key) {
    const serializedMessage = process(message)

    const estimatedMessageBytesCount =
      encoder.estimateEncodedBytesCount(serializedMessage)

    if (estimatedMessageBytesCount >= messageBytesLimit) {
      display.warn(
        `Discarded a message whose size was bigger than the maximum allowed size ${messageBytesLimit}KB.`
      )
      return
    }

    if (hasMessageFor(key)) {
      // Keep the original flush deadline while replacing an upsert. Otherwise,
      // a frequently updated View can postpone its flush indefinitely when it
      // is the only message in the batch.
      remove(key, true)
    }

    push(serializedMessage, estimatedMessageBytesCount, key)
  }

  function flush(event) {
    var hasCurrentRawMessages =
      fallbackMessagesBuffer.length > 0 || !isEmptyObject(upsertBuffer)
    if (
      !hasCurrentRawMessages &&
      pendingRawBatches.length === 0 &&
      (!event || !event.messagesCount) &&
      encoder.isEmpty()
    ) {
      return
    }
    currentBatchGeneration += 1
    var flushedEncoder = encoder
    var upsertMessageValues = values(upsertBuffer)
    var upsertMessages = upsertMessageValues.join(
      sendContentTypeByJson ? ',' : '\n'
    )
    upsertBuffer = {}
    upsertMessageBytesCountByKey = {}
    upsertRawBytesCountByKey = {}
    upsertRawBytesCount = 0
    var rawFallbackFlush = rawFallbackBatchActive
    var fallbackMessages =
      flushedEncoder.isAsync || encoderFallback || rawFallbackFlush
      ? fallbackMessagesBuffer.concat(upsertMessageValues)
      : undefined
    fallbackMessagesBuffer = []
    fallbackMessagesBufferBytesCount = 0
    rawFallbackBatchActive = false

    var isPageExit = isPageExitReason(event.reason)
    var send = isPageExit ? request.sendOnExit : request.send
    var pendingRawBatch =
      !isPageExit && flushedEncoder.isAsync
        ? addPendingRawBatch(fallbackMessages)
        : undefined

    if (
      isPageExit &&
      // A previous asynchronous encoder may already have fallen back while
      // its raw journal is still waiting for finish(). Page exit must promote
      // that journal even when the current encoder is now synchronous.
      (flushedEncoder.isAsync || pendingRawBatches.length > 0)
    ) {
      var encoderResult = flushedEncoder.finishSync()
      var pendingMessages = consumePendingRawMessages().concat(
        fallbackMessages || []
      )

      if (encoderResult.error) {
        switchToFallbackEncoder(flushedEncoder, false)
      }

      // A synchronous finish can contain a compressed prefix from an older
      // unfinished batch and raw framing from a newer one. Neither part is a
      // valid standalone payload. Send the raw journal instead; it preserves
      // complete original messages and exact finish boundaries.
      sendMessages(
        send,
        pendingMessages,
        sendContentTypeByJson,
        bytesLimit
      )
    } else {
      if (upsertMessages) {
        var text = getMessageText(
          [upsertMessages],
          flushedEncoder.isEmpty()
        )
        if (sendContentTypeByJson) {
          text += ']'
        }
        flushedEncoder.write(text)
      } else {
        if (sendContentTypeByJson) {
          flushedEncoder.write(']')
        }
      }
      flushedEncoder.finish(function (encoderResult) {
        if (
          pendingRawBatch &&
          !releasePendingRawBatch(pendingRawBatch)
        ) {
          // A page-exit flush already sent this batch from the raw journal.
          return
        }
        if (encoderResult.error) {
          switchToFallbackEncoder(flushedEncoder)
          sendMessages(
            send,
            fallbackMessages,
            sendContentTypeByJson,
            bytesLimit
          )
          return
        }
        if (rawFallbackFlush) {
          sendMessages(
            send,
            fallbackMessages,
            sendContentTypeByJson,
            bytesLimit
          )
          return
        }
        if (encoderResult.outputBytesCount) {
          send(
            formatPayloadFromEncoder(
              encoderResult,
              sendContentTypeByJson
            )
          )
        } else {
          sendMessages(
            send,
            fallbackMessages,
            sendContentTypeByJson,
            bytesLimit
          )
        }
      })
    }
  }

  function addPendingRawBatch(messages) {
    var batch = {
      messages: messages || [],
      bytesCount: computeRawMessagesBytesCount(messages),
      isActive: true
    }
    pendingRawBatches.push(batch)
    pendingRawBatchesBytesCount += batch.bytesCount
    return batch
  }

  function releasePendingRawBatch(batch) {
    if (!batch.isActive) {
      return false
    }
    batch.isActive = false
    var index = pendingRawBatches.indexOf(batch)
    if (index !== -1) {
      pendingRawBatches.splice(index, 1)
    }
    pendingRawBatchesBytesCount = Math.max(
      0,
      pendingRawBatchesBytesCount - batch.bytesCount
    )
    return true
  }

  function consumePendingRawMessages() {
    var messages = []
    pendingRawBatches.forEach(function (batch) {
      batch.isActive = false
      messages = messages.concat(batch.messages)
    })
    pendingRawBatches = []
    pendingRawBatchesBytesCount = 0
    return messages
  }

  function drainPendingRawBatches() {
    var batches = pendingRawBatches
    pendingRawBatches = []
    pendingRawBatchesBytesCount = 0
    batches.forEach(function (batch) {
      batch.isActive = false
      sendMessages(
        request.send,
        batch.messages,
        sendContentTypeByJson,
        bytesLimit
      )
    })
  }

  function switchToFallbackEncoder(failedEncoder, drainPending = true) {
    if (!encoderFallback || encoder !== failedEncoder) {
      return
    }
    var createFallbackEncoder = encoderFallback
    encoderFallback = undefined
    encoder = createFallbackEncoder()
    // The flush controller accounted the current batch with the failed
    // encoder's estimate. Keep its original messages until the identity
    // encoder flushes so the raw payload can still honor the batch limit.
    rawFallbackBatchActive =
      fallbackMessagesBuffer.length > 0 || !isEmptyObject(upsertBuffer)
    if (fallbackMessagesBuffer.length) {
      encoder.write(
        getMessageText(fallbackMessagesBuffer, encoder.isEmpty())
      )
    }
    if (drainPending) {
      drainPendingRawBatches()
    }
    if (failedEncoder.stop) {
      failedEncoder.stop()
    }
  }

  return {
    flushController: flushController,
    add: addOrUpdate,
    upsert: addOrUpdate,
    stop: flushSubscription.unsubscribe
  }
}

function computeRawMessagesBytesCount(messages) {
  if (!messages || !messages.length) {
    return 0
  }
  return messages.reduce(function (bytesCount, message) {
    return bytesCount + computeBytesCount(message) + 1
  }, 0)
}

function sendMessages(
  send,
  messages,
  sendContentTypeByJson,
  bytesLimit
) {
  if (!messages) {
    return
  }
  var filteredMessages = messages.filter(Boolean)
  if (!filteredMessages.length) {
    return
  }

  var messagesBuffer = []
  var messagesBufferBytesCount = sendContentTypeByJson ? 2 : 0
  filteredMessages.forEach(function (message) {
    var separatorBytesCount = messagesBuffer.length ? 1 : 0
    var messageBytesCount = computeBytesCount(message)
    if (
      messagesBuffer.length &&
      typeof bytesLimit === 'number' &&
      messagesBufferBytesCount +
        separatorBytesCount +
        messageBytesCount >
        bytesLimit
    ) {
      sendMessagesBuffer(
        send,
        messagesBuffer,
        messagesBufferBytesCount,
        sendContentTypeByJson
      )
      messagesBuffer = []
      messagesBufferBytesCount = sendContentTypeByJson ? 2 : 0
      separatorBytesCount = 0
    }
    messagesBuffer.push(message)
    messagesBufferBytesCount +=
      separatorBytesCount + messageBytesCount
  })
  sendMessagesBuffer(
    send,
    messagesBuffer,
    messagesBufferBytesCount,
    sendContentTypeByJson
  )
}

function sendMessagesBuffer(
  send,
  messages,
  messagesBytesCount,
  sendContentTypeByJson
) {
  var data = sendContentTypeByJson
    ? '[' + messages.join(',') + ']'
    : messages.join('\n')
  if (!data) {
    return
  }
  send({
    data: data,
    type: sendContentTypeByJson ? 'application/json;UTF-8' : undefined,
    bytesCount: messagesBytesCount
  })
}

function formatPayloadFromEncoder(encoderResult, sendContentTypeByJson) {
  var data
  if (typeof encoderResult.output === 'string') {
    data = encoderResult.output
  } else {
    data = new Blob([encoderResult.output], {
      // This will set the 'Content-Type: text/plain' header. Reasoning:
      // * The intake rejects the request if there is no content type.
      // * The browser will issue CORS preflight requests if we set it to 'application/json', which
      // could induce higher intake load (and maybe has other impacts).
      // * Also it's not quite JSON, since we are concatenating multiple JSON objects separated by
      // new lines.
      type: 'text/plain'
    })
  }

  return {
    data: data,
    type: sendContentTypeByJson ? 'application/json;UTF-8' : undefined,
    bytesCount: encoderResult.outputBytesCount,
    encoding: encoderResult.encoding
  }
}
