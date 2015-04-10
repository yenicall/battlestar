var util = require('util'),
    path = require('path'),
    cluster = require('cluster'),
    events = require('events');


function Worker(appId,db) {
    db.find({appId: appId}, function (err, doc) {
        if (err) {
            return this.emit('error', err);
        }
    });
}
Worker.prototype = new events.EventEmitter();

Worker.prototype.start = function (app) {
    process.chdir(path.dirname(app));
    process.stdout.write = (function (write) {
        return function (string, encoding, fd) {
            process.send({
                type: 'log:out',
                data: string
            });
        }
    })(process.stdout.write);
    process.stderr.write = (function (write) {
        return function (string, encoding, fd) {
            process.send({
                type: 'log:err',
                data: string
            });
        }
    })(process.stderr.wrte);
    process.on('uncaughtException', function (err) {
        process.send({
            type: 'log:exp',
            data: err.stack
        });
        process.emit('disconnect');
        process.exit(0);
    });
    require(app);
};
module.exports = Worker;