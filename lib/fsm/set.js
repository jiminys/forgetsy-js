var states = require(__dirname + '/states');
var connection = require(__dirname + '/../../lib/connection');
var client = connection.get();
var LAST_DECAYED_KEY = '_last_decay';
var LIFETIME_KEY = '_t';
var HI_PASS_FILTER = 0.0001;
var FSM = require("javascript-state-machine/state-machine")

var events = {
  IDLE: 'Idle'
  ,DECAY_THEN_SCRUB: 'DecayThenScrub'
  ,DECAY_TO_SCRUB: 'DecayToScrub'
  ,DECAY_THEN_FETCH: 'DecayThenFetch'
  ,SCRUB_THEN_FETCH: 'ScrubThenFetch'
  ,FETCH: 'Fetch'
  ,DECAY: 'Decay'
  ,FETCH_BIN: 'FetchBin'
  ,FETCH_RAW: 'FetchRaw'
  ,INCREMENT: 'Increment'
  ,FILTER_KEYS: 'FilterKeys'
  ,VALIDATE_INCREMENT_DATE: 'ValidateIncrementDate'
  ,UPDATE_DECAY_DATE: 'UpdateDecayDate'
  ,FETCH_LAST_DECAY_DATE: 'FetchLastDecayDate'
  ,FETCH_LIFETIME_DATE: 'FetchLifetimeDate'
};

var eventsMap = [
   { name: events.DECAY_THEN_SCRUB, from: events.IDLE,  to: events.DECAY_TO_SCRUB }
  ,{ name: events.DECAY_THEN_FETCH, from: events.IDLE,  to: events.DECAY_TO_FETCH }
  ,{ name: events.SCRUB_THEN_FETCH, from: events.IDLE,  to: events.SCRUB_TO_FETCH }
  ,{ name: events.SCRUB_THEN_FETCH, from: events.DECAY, to: events.SCRUB_TO_FETCh }
];

function Set(key) {
  this.key = key;
  this.initFSM();
}

Set.prototype.initFSM = function() {
  var self = this
  this.fsm = FSM.create({
    initial: events.IDLE
    ,events: eventsMap
    ,callbacks: {
        onDecayToScrub: this.onDecayToScrub.bind(this)
      //, onScrubThenFetch: this.onScrubThenFetch.bind(this)
      , onFetch: this.onFetch.bind(this)
    }
  });
};

Set.prototype.fetch = function(opts) {
  this._limit = opts.limit || -1;
  this._decay = (opts.decay === false) ? false : true;
  this._scrub = (opts.scrub === false) ? false : true;
  this._bin   = opts.bin || null;

  if (this._scrub && this._decay) {
    this.fsm.DecayThenScrub();
  } else if (this._scrub) {
    this.fsm.ScrubThenFetch();
  } else if (this._decay) {
    this.fsm.DecayThenFetch();
  } else {
    this.fsm.Fetch();
  }
};

Set.prototype.getLastDecayDate = function(cb) {
  client.zscore([this.key, this.last_decayed_key], function(e, res) {
    cb(e, res);
  });
};

Set.prototype.onDecayToScrub = function() {
  console.log('onDecayToScrub')
  var self = this;
  this.decay(function(e, res) {
    self.scrub(function(e, res) {
      self.fsm.Fetch();
    })
  })
};

Set.prototype.decay = function(cb) {
  cb(null, {});
};

Set.prototype.scrub = function(cb) {
  cb(null, {});
};

Set.prototype.onFetch = function() {
  console.log('onFetch');
};

var set = new Set('foo');
set.fetch({});

/*
Set.prototype.fetch = function(opts) {
  var limit = opts.limit || -1;
  var decay = (opts.decay === false) ? false : true;
  var scrub = (opts.scrub === false) ? false : true;

  if (scrub && decay) {
    fsm.state(states.SCRUBBING_THEN_DECAYING);
  } else if (scrub) {
    fsm.state(states.SCRUB_ONLY);
  } else if (decay) {
    fsm.state(states.DECAY_ONLY);
  } else {
    fsm.state(states.FETCHING_RAW);
  }
};



var when = require('when');
var connection = require('./lib/connection');
var client = connection.get();

function arrayToObject(arr) {
  var tmp = {};
  var len = arr.length;
  for (var i=0; i<len; i++) {
    if ((i % 2) == 0) {
      tmp[arr[i]] = arr[++i];
    }
  }

  return tmp;
}

var Set = function(key) {
  this.key = key;
  this.last_decayed_key = '_last_decay';
  this.lifetime_key = '_t';
  this.hi_pass_filter = 0.0001;
};

Set.prototype.fetch = function(opts) {
  var limit = opts.limit || -1;
  var self = this;
  var run = function() {
    if (opts.bin) {
      var d = when.defer();
      client.zscore([self.key, opts.bin], function(e, res) {
        if (e) {
          d.reject(e);
        } else {
          d.resolve(res);
        }
      });
      return d.promise;
    } else {
      return when(self.fetchRaw({limit: limit}));
    }
  };

  if (opts.decay) {
    var promise = when(this.decay(opts));
    return promise.then(function() {
      if (opts.scrub) {
        var promise = when(self.scrub(opts));
        return promise.then(function() {
          return run();
        });
      }
    });
  } else {
    return run();
  }

};

Set.prototype.decay = function(opts) {
  opts = opts || {};
  var d = when.defer();
  var t0 = null;
  var t1 = opts.date || Date.now();
  var delta = t1 - t0;
  var rate = null;
  var self = this;

  when(this.getLastDecayDate())
    .then(function(date) {
      // set the delta
      t0 = date;
      delta = t1 - t0;
      // get the set
      when(self.fetchRaw())
        .then(function(set) {
          // get the lifetime
          when(self.getLifetime())
            .then(function(lifetime) {
              rate = 1 / lifetime;
              var multi = client.multi();

              for (var i in set) {
                var v = set[i] * Math.exp(-delta * rate);
                multi.zadd(self.key, v, i);
              }

              multi.exec(function(e, replies) {
                if (e) {
                  d.reject(e);
                } else {
                  when(self.updateDecayDate(Date.now()))
                    .then(d.resolve)
                    .otherwise(d.reject);
                }
              });
            }).otherwise(d.reject);
        }).otherwise(d.reject);
    }).otherwise(d.reject);

  return d.promise;
};

Set.prototype.getLifetime = function() {
  var d = when.defer();
  client.zscore([this.key, this.lifetime_key], function(e, lifetime) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(lifetime);
    }
  });
  return d.promise;
};

Set.prototype.scrub = function(cb) {
  var d = when.defer();
  client.zremrangebyscore([this.key, '-inf', this.hi_pass_filter], function(e, res) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(res);
    }
  });

  return d.promise; 
};

Set.prototype.getLastDecayDate = function() {
  var d = when.defer();
  client.zscore([this.key, this.last_decayed_key], function(e, res) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(parseInt(res,10));
    }
  });
  return d.promise;
};

Set.prototype.fetchRaw = function(opts) {
  var d = when.defer();
  opts = opts || {};
  var limit = opts.limit || -1;
  var bufferedLimit = limit;
  var self = this;

  if (limit > 0) {
    bufferedLimit += this.specialKeys().length;
  }

  client.zrevrange(this.key, 0, bufferedLimit, 'withscores', function(e, set) {
    if (e) {
      d.reject(e);
    } else {
      set = arrayToObject(set);
      set = self.filterSpecialKeys(set);
      d.resolve(set);
    }
  });

  return d.promise;
};

Set.prototype.updateDecayDate = function(date) {
  var d = when.defer();
  client.zadd([this.key, date, this.last_decayed_key], function(e, res) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(res);
    }
  });
  return d.promise;
};

Set.prototype.incr = function(opts) {
  var d = when.defer();
  var date = opts.date || Date.now();
  var self = this;
  opts.by = opts.by || 1;
  when(this.isValidIncrDate(date))
    .then(function() {
      client.zincrby([self.key, 1, opts.bin], function(e, res) {
        if (e) {
          d.reject(e);
        } else {
          d.resolve(res);
        }
      });
    }).otherwise(function() {
      d.reject(new Error('Invalid increment date!'));
    });

  return d.promise;
};

Set.prototype.isValidIncrDate = function(date) {
  var d = when.defer();

  when(this.getLastDecayDate())
    .then(function(_date) {
      if (date > _date) {
        d.resolve()
      } else {
        d.reject()
      }
    }).otherwise(d.reject);

  return d.promise;
};

Set.prototype.specialKeys = function() {
  return [this.lifetime_key, this.last_decayed_key];
};

Set.prototype.createLifetimeKey = function(date) {
  var d = when.defer();
  client.zadd([this.key, date, this.lifetime_key], function(e, res) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(res);
    }
  });
  return d.promise;
};

/**
# @param float opts[time] : mean lifetime of an observation (secs).
# @param datetime opts[date] : a manual date to start decaying from.
*
exports.create = function(opts) {
  if (!opts['time']) {
    throw new Error('Missing required option: object.time');
  }

  //var d = when.defer();
  var date = opts['date'] || Date.now();
  var set = new Set(opts.key);
  return set.updateDecayDate(date).then(function() {
    return set.createLifetimeKey(opts.time);
  });
};

/**
Need to understand better what's going on
here in Ruby
*
Set.prototype.filterSpecialKeys = function(set, limit) {
  var newSet = {};
  var specialKeys = this.specialKeys();
  var keys = Object.keys(set);

  for (var i=0; i<specialKeys.length; i++) {
    if (set[specialKeys[i]]) {
      delete set[specialKeys[i]];
    }
  }

  return set;
};

exports.fetch = function(name) {
  return new Set(name);
};

var set = exports.fetch('follows');
*/