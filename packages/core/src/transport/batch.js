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
  var request = options.request
  var messageBytesLimit = options.messageBytesLimit
  var sendContentTypeByJson = options.sendContentTypeByJson
  var flushController = options.flushController
  var upsertBuffer = {}
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

    if (key !== undefined) {
      upsertBuffer[key] = serializedMessage
      flushController.notifyAfterAddMessage()
    } else {
      encoder.write(
        getMessageText([serializedMessage], encoder.isEmpty()),
        function (realMessageBytesCount) {
          flushController.notifyAfterAddMessage(
            realMessageBytesCount - estimatedMessageBytesCount
          )
        }
      )
    }
  }

  function hasMessageFor(key) {
    return key !== undefined && upsertBuffer[key] !== undefined
  }

  function remove(key) {
    var removedMessage = upsertBuffer[key]
    delete upsertBuffer[key]
    var messageBytesCount = encoder.estimateEncodedBytesCount(removedMessage)
    flushController.notifyAfterRemoveMessage(messageBytesCount)
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
      remove(key)
    }

    push(serializedMessage, estimatedMessageBytesCount, key)
  }

  function flush(event) {
    var upsertMessages = values(upsertBuffer).join(
      sendContentTypeByJson ? ',' : '\n'
    )
    upsertBuffer = {}

    var isPageExit = isPageExitReason(event.reason)
    var send = isPageExit ? request.sendOnExit : request.send

    if (
      isPageExit &&
      // Note: checking that the encoder is async is not strictly needed, but it's an optimization:
      // if the encoder is async we need to send two requests in some cases (one for encoded data
      // and the other for non-encoded data). But if it's not async, we don't have to worry about
      // it and always send a single request.
      encoder.isAsync
    ) {
      var encoderResult = encoder.finishSync()

      // Send encoded messages
      if (encoderResult.outputBytesCount) {
        send(formatPayloadFromEncoder(encoderResult, sendContentTypeByJson))
      }

      // Send messages that are not yet encoded at this point
      var pendingMessages = [encoderResult.pendingData, upsertMessages]
        .filter(Boolean)
        .join('\n')

      if (pendingMessages) {
        send({
          data: pendingMessages,
          bytesCount: computeBytesCount(pendingMessages)
        })
      }
    } else {
      if (upsertMessages) {
        var text = getMessageText([upsertMessages], encoder.isEmpty())
        if (sendContentTypeByJson) {
          text += ']'
        }
        encoder.write(text)
      } else {
        if (sendContentTypeByJson) {
          encoder.write(']')
        }
      }
      encoder.finish(function (encoderResult) {
        send(formatPayloadFromEncoder(encoderResult))
      })
    }
  }

  return {
    flushController: flushController,
    add: addOrUpdate,
    upsert: addOrUpdate,
    stop: flushSubscription.unsubscribe
  }
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
