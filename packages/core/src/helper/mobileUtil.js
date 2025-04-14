export var userAgent = navigator.userAgent.toLowerCase()
export var isAndroid = function () {
  return /android/.test(userAgent)
}
export var isIos = function () {
  return /iphone os/.test(userAgent)
}

var JsBirdge = function () {
  this.bridge = window['FTWebViewJavascriptBridge']
  this.tagMaps = {}
  window.mapWebViewCallBack = {}
  try {
    this.initBridge()
  } catch (err) {}
}
JsBirdge.prototype = {
  initBridge: function () {
    var _this = this
    if (isIos()) {
      if (!_this.bridge) {
        if (window.WVJBCallbacks) {
          window.WVJBCallbacks.push(function (bridge) {
            _this.bridge = bridge
          })
          return
        } else {
          window.WVJBCallbacks = [
            function (bridge) {
              _this.bridge = bridge
              return
            }
          ]
          var WVJBIframe = document.createElement('iframe')
          WVJBIframe.style.display = 'none'
          WVJBIframe.src = 'wvjbscheme://__BRIDGE_LOADED__'
          document.documentElement.appendChild(WVJBIframe)
          setTimeout(function () {
            document.documentElement.removeChild(WVJBIframe)
          }, 0)
        }
      }
    }
  },
  sendEvent: function (params, callback) {
    if (typeof params === 'undefined') {
      params = {}
    }
    var _this = this
    var tag = 'Unique id:' + new Date().getTime()
    if (params.name) {
      _this.tagMaps[params.name] = tag
      window.mapWebViewCallBack[tag] = function (ret, err) {
        return Promise.resolve(ret, err)
      }
      params['_tag'] = tag
      try {
        if (isIos()) {
          _this.bridge.callHandler(
            'sendEvent',
            JSON.stringify(params),
            'mapWebViewCallBack'
          )
        } else {
          _this.bridge.sendEvent(JSON.stringify(params), 'mapWebViewCallBack')
        }
      } catch (err) {}
    } else {
      callback({ error: '请传入发送事件的名称！！' })
    }
  },
  addEventListener: function (params, callback) {
    var tag = 'Unique id:' + new Date().getTime()
    var _this = this
    if (params.name) {
      _this.tagMaps[params.name] = tag
      window.mapWebViewCallBack[tag] = function (ret, err) {
        callback(ret, err)
        return
      }
      params['_tag'] = tag
      try {
        if (isIos()) {
          _this.bridge.callHandler(
            'addEventListener',
            JSON.stringify(params),
            'mapWebViewCallBack'
          )
        } else {
          _this.bridge.addEventListener(
            JSON.stringify(params),
            'mapWebViewCallBack'
          )
        }
      } catch (err) {}
    } else {
      callback({ error: '请传入监听事件的名称！！' })
    }
  }
}

export var JsBirdge = JsBirdge
