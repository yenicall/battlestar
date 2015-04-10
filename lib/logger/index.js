var colors = require('colors/safe'),
    util=require('util');

module.exports = {
    log: function (color, section) {
        var strings = arguments.length >= 3 ? [].slice.call(arguments, 2) : [];
        section = colors[color]((new Date).toISOString(), '[' + section + '] :');
        console.log(section, util.format.apply(null, strings));
    },
    debug: function (section) {
        var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
        args.unshift('blue', section);
        this.log.apply(this, args);
    },
    verbose: function (section) {
        var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
        args.unshift('cyan', section);
        this.log.apply(this, args);
    },
    info: function (section) {
        var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
        args.unshift('green', section);
        this.log.apply(this, args);
    },
    error: function (section) {
        var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
        args.unshift('red', section);
        this.log.apply(this, args);
    },
    warn: function (section) {
        var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
        args.unshift('yellow', section);
        this.log.apply(this, args);
    }
};