var colors = require('colors/safe'),
    util = require('util'),
    logger = null;

function Logger() {
    this._levels = ['DEBUG', 'VERBOSE', 'INFO', 'WARN', 'ERROR'];
    this.colors = ["blue", "cyan", "green", "yellow", "red"];
    this.level = 'INFO';
    this.transports = [{
        name: 'console',
        colorize: true,
        log: function () {
            var args = [].slice.call(arguments, 0),
                section = args.shift();
               args.shift();
            args.unshift(section);
            console.log.apply(null, args);
        }
    }];
}

Logger.prototype.addTransport = function (name, log, colorize) {
    this.transports.push({
        name: name,
        log: log,
        colorize: colorize
    })
};
Logger.prototype.log = function (level, section) {
    level = level.toUpperCase();
    var levelPosition = this._levels.indexOf(level),
        position = this._levels.indexOf(this.level);
    if (levelPosition === -1 && levelPosition < position) {
        return;
    }
    var strings = arguments.length >= 3 ? [].slice.call(arguments, 2) : [];
    section = (new Date).toISOString() + ' [' + section + '] :';
    this.transports.forEach(function (transport) {
        if (transport.colorize) {
            section = colors[this.colors[levelPosition]](section);
        }
        transport.log.call(null, section, level, util.format.apply(null, strings));
    }.bind(this));
};
Logger.prototype.debug = function (section) {
    var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
    args.unshift('debug', section);
    this.log.apply(this, args);
};
Logger.prototype.verbose = function (section) {
    var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
    args.unshift('verbose', section);
    this.log.apply(this, args);
};
Logger.prototype.info = function (section) {
    var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
    args.unshift('info', section);
    this.log.apply(this, args);
};
Logger.prototype.warn = function (section) {
    var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
    args.unshift('warn', section);
    this.log.apply(this, args);
};
Logger.prototype.error = function (section) {
    var args = arguments.length >= 2 ? [].slice.call(arguments, 1) : [];
    args.unshift('error', section);
    this.log.apply(this, args);
};

if (logger === null) {
    logger = new Logger();
}
module.exports = logger;