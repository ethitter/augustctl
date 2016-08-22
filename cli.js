#!/usr/bin/env node

'use strict';

var augustctl = require('./index');

var config = require(process.env.AUGUSTCTL_CONFIG || './config.json');

var whichLock = process.argv[2];
if ( config.hasOwnProperty(whichLock) ) {
  config = config[whichLock];
} else {
  throw new Error('invalid lock specified:' + whichLock);
}

var op = process.argv[3];
if (typeof augustctl.Lock.prototype[op] !== 'function') {
  throw new Error('invalid operation: ' + op);
}

augustctl.scan(config.lockUuid).then(function(peripheral) {
  var lock = new augustctl.Lock(
    peripheral,
    config.offlineKey,
    config.offlineKeyOffset
  );
  lock.connect().then(function() {
    return lock[op]();
  }).catch(function(e) {
    console.error(e.toString());
  }).finally(function() {
    return lock.disconnect().finally(function() {
      process.exit(0);
    });
  });
});
