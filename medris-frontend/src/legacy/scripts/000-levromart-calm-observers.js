/* Many parts of the app watch the whole page for changes, and each used to be woken for every single change (thousands
   of times while a screen loads). Here every watcher is woken at most once per frame with everything that changed in
   that frame, still before the screen is painted, so nothing flickers and nothing is missed. */
(function () {
  "use strict";
  var Native = window.MutationObserver;
  if (!Native || window.__lvCalmObservers) return;
  window.__lvCalmObservers = true;
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (f) { return setTimeout(f, 16); };
  var caf = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  function CalmObserver(callback) {
    var self = this, pending = [], frame = 0;
    function flush() {
      frame = 0;
      var records = pending; pending = [];
      if (records.length) callback.call(self, records, self);
    }
    var real = new Native(function (records) {
      for (var i = 0; i < records.length; i++) pending.push(records[i]);
      if (!frame) frame = raf(flush);
    });
    this.observe = function (target, options) { return real.observe(target, options); };
    this.disconnect = function () { if (frame) { caf(frame); frame = 0; } pending = []; return real.disconnect(); };
    this.takeRecords = function () { var r = pending.concat(real.takeRecords()); pending = []; return r; };
  }
  CalmObserver.prototype = Native.prototype;
  window.MutationObserver = CalmObserver;
})();
