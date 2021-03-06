/* Copyright (c) 2012 Joe Lynch <yhf@ncsc.io>, http://plivode.ncsc.io/
 * Licensed under the MIT License:
 * http://www.opensource.org/licenses/mit-license.php
 */

var url = require('url')
  , _   = require('underscore')
  , ApiClient = require('./api/client')
  , Response  = require('./response')
  , Compose   = require('compose')
  , Base62    = require('base62')
  , EventEmitter = require('events').EventEmitter

/**
 * @class App
 * @description Creates a new Plivode application, host receiving and sending commands between Plivo and this app.
 * @param {object} params An object containing the `authID` and `authToken` for your Plivo account,
 *  the `appID` of your application, and the `rootUrl` Plivo can access this service.
 *  If `authID` and `authToken` are omitted, the static fields `ApiClient.authID` and `ApiClient.authToken` must be set.
 * @augments ApiClient
 *
 */
var App = module.exports = Compose(EventEmitter, ApiClient, function(params) {
  var self = this;

  params.authID && (this.authID = params.authID);
  params.authToken && (this.authToken = params.authToken);
  this.appID = params.appID;
  this.rootUrl = typeof params.rootUrl === 'string'
    ? url.parse(params.rootUrl.match(/\/$/) ? params.rootUrl : params.rootUrl + '/', false, true)
    : params.rootUrl;

  this._eventRoutes = {};
  this.expressApp = params.expressApp;
  var _pendingAppUrls = null;

  function _updateEventAppUrl(event) {
    var rootUrl = self.rootUrl.href;

    if (!_pendingAppUrls) {
      _pendingAppUrls = {};

      // Delay the update of app urls until the next run loop, so multiple urls can be updated at once
      setTimeout(function() {
        self.update(_pendingAppUrls, function() { _pendingAppUrls = null });
      }, 0);
    }

    _pendingAppUrls[event + '_url'] = rootUrl + event;
  }

  this.on('newListener', function(event) {
    var isNewRoute = self._addEventRoute(event);
    if (isNewRoute && ~['answer', 'hangup', 'message'].indexOf(event)) {
      _updateEventAppUrl(event);
    }
  });

  // Extend this with an instance the Application rest client tied to this app id, then delete the Application property
  _.extend(this, this.Application(this.appID));
  delete this.Application;
}, {
  param: function(paramName, fn) {
    this.expressApp.param(paramName, fn);
    return this;
  },

  _absoluteUrl: function(url) {
    return url.match(/\/\//) ? url : this.rootUrl.href + url;
  },

  _getCallbackUrl: function(cb) {
    if (typeof cb === 'string') {
      return this._absoluteUrl(cb);
    } else if (Array.isArray(cb)) {
      return this._absoluteUrl(cb.map(encodeURIComponent).join('/'));
    } else if (typeof cb === 'function') {
      return this._registerAnonymousCallback(cb);
    }
    return cb;
  },

  _ANON_RESOURCE: '__anon__',

  _registerAnonymousCallback: function(cb) {
    App._nextAnonCBID = ++App._nextAnonCBID || 0;

    var route = this._ANON_RESOURCE + Base62.encode(App._nextAnonCBID);

    this._addEventRoute(route, cb);

    return this.rootUrl.href + route;
  },

  _IGNORE_HANGUP_RESOURCE: '__ignore_hangup__',

  _getIgnoreHangupUrl: function() {
    this._addEventRoute(this._IGNORE_HANGUP_RESOURCE);
    return this._getCallbackUrl(this._IGNORE_HANGUP_RESOURCE);
  },
  
  _addEventRoute: function(event, cb) {
    var self = this;
    if (!self._eventRoutes[event]) {
      self._eventRoutes[event] = true;

      var route = event.match(/$\//) ? event : '/' + event;
      //TODO: set post method for url
      self.expressApp.post(route, function(req, res) {
        //TODO: need to pass things done by param fns
        if (cb) {
          cb(Compose.create(req.params, req.body), new Response(res, self));
        } else {
          self.emit(event, Compose.create(req.params, req.body), new Response(res, self));
        }
      });
      return true;
    }
    return false;
  }
});
