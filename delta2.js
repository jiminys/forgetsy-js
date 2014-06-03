var Set = require('./set2');
var time = require('./time');
var when = require('when');
var connection = require('./connection');
var client = connection.get();
var NORM_T_MULT = 2;

var Delta = function(name) {
  this.name = name;
};

Delta.prototype.init = function(opts) {
  if (!opts.time) {
    throw new Error('Missing time');
  }

  var d = when.defer();
  var self = this;
  var secondaryDate = Date.now() - ((Date.now() - opts.date) * NORM_T_MULT);
  when(Set.create({
    key: this.getPrimaryKey()
    , time: opts.time
    , date: opts.date
    , name: this.name
  })).then(function() {
    when(Set.create({
      key: self.getSecondaryKey()
      , time: opts.time * NORM_T_MULT
      , date: secondaryDate
      , name: self.name
    })).then(d.resolve).otherwise(d.reject);
  }).otherwise(d.reject);

  return d.promise;
};

Delta.prototype.fetch = function(opts) {
  opts = opts || {};
  var d = when.defer();
  var limit = opts.limit || -1;
  delete opts.limit;
  var bin = opts.bin || null;
  var count = 0;
  var norm = 0;
  var result = null;
  var self = this;

  if (!bin) {
    when(this.getSet(this.getPrimaryKey()))
      .then(function(primarySet) {
        when(self.getSet(self.getSecondaryKey()))
          .then(function(secondarySet) {
            when(primarySet.fetch(opts))
              .then(function(_count) {
                count = _count;
                when(secondarySet.fetch(opts))
                  .then(function(_norm) {
                    norm = _norm;
                    value = 0;
                    var results = [];
                    for (var i in count) {
                      var norm_v = norm[i];
                      var value = (typeof norm_v === 'undefined') ? 0 : parseFloat(count[i]) / parseFloat(norm_v).toFixed(2);
                      results[i] = value;
                    }
                    d.resolve(results);
                  })
              }).otherwise(function(e) {
                console.log('Error', e);
                d.reject(e);
              });
          })
          .otherwise(d.reject);
      }).otherwise(function(e) {
        console.log('error', e);
        d.reject(e);
      })
  } else {
    when(this.getSet(this.getPrimaryKey()))
      .then(function(primarySet) {
        when(self.getSet(self.getSecondaryKey()))
          .then(function(secondarySet) {
            when(primarySet.fetch(opts))
              .then(function(_count) {
                count = _count;
                when(secondarySet.fetch(opts))
                  .then(function(_norm) {
                    norm = _norm;
                    var results = {};
                    if (!norm) {
                      results[bin] = null;
                    } else {
                      var norm_v = parseFloat(count) / parseFloat(norm).toFixed(2);
                      results[bin] = norm_v;
                    }
                    d.resolve(results);
                  })
              }).otherwise(function(e) {
                d.reject(e);
              });
          })
          .otherwise(d.reject);
      }).otherwise(function(e) {
        d.reject(e);
      })
  }

  return d.promise;
};

Delta.prototype.incr = function(opts) {
  var d = when.defer();
  when(this.getSets())
    .then(function(sets) {
      var errors = [];
      var count = 0;      
      var check = function() {
        if (++count >= sets.length) {
          if (errors.length > 0) {
            d.reject(errors);
          } else {
            d.resolve();
          }
        }
      };
      
      sets.forEach(function(set) {
        when(set.incr(opts))
          .then(function(){
            check();
          })
          .otherwise(function(e) {
            console.log('E', e);
            errors.push(e);
            check();
          })
      });
    }).otherwise(d.reject);

  return d.promise;
};

Delta.prototype.incr_by = function(opts) {
  var d = when.defer();
  when(this.getSets())
    .then(function(sets) {
      var errors = [];
      var count = 0;
      var check = function() {
        if (++count >= sets.length) {
          if (errors.length > 0) {
            d.reject(errors);
          } else {
            d.resolve();
          }
        }
      };
      
      sets.forEach(function(i, set) {
        when(set.incr_by(opts))
          .then(function(){
            check();
          })
          .otherwise(function(e) {
            errors.push(e);
            check();
          })
      });
    }).otherwise(d.reject);

  return d.promise;
};

Delta.prototype.exists = function(name) {
  var d = when.defer();

  client.exists(name, function(e, res) {
    if (e) {
      d.reject(e);
    } else {
      d.resolve(res);
    }
  });

  return d.promise;
};

Delta.prototype.getSet = function(key) {
  var d = when.defer();

  when(Set.fetch(key))
    .then(d.resolve)
    .otherwise(d.reject);

  return d.promise;
};

Delta.prototype.getSets = function() {
  var d = when.defer();
  var sets = [];
  var self = this;
  when(this.getSet(this.getPrimaryKey()))
    .then(function(set) {
      sets.push(set);
      when(self.getSet(self.getSecondaryKey()))
        .then(function(set) {
          sets.push(set);
          d.resolve(sets);
        }).otherwise(d.reject);
    }).otherwise(d.reject);

  return d.promise;
};

Delta.prototype.getPrimaryKey = function() {
  return this.name;
};

Delta.prototype.getSecondaryKey = function() {
  return this.name + '_2t';
};

/**
@param float opts[t] : mean lifetime of an observation (secs).
@param datetime opts[date] : a manual date to start decaying from.
*/
exports.create = function(opts) {
  var d = when.defer();
  if (!opts.name) {
    throw new Error('Missing distribution name');
  }

  if (!opts.time) {
    throw new Error('Missing mean lifetime');
  }

  opts.date = opts.date || Date.now();

  var delta = new Delta(opts.name);
  when(delta.init(opts))
    .then(function() {
      d.resolve(delta);
    }).otherwise(d.reject);
  return d.promise;
};

exports.fetch = function(name) {
  var d = when.defer();
  var delta = new Delta(name);
  when(delta.exists(name))
    .then(function() {
      d.resolve(delta);
    }).otherwise(d.reject);
  return d.promise;
};