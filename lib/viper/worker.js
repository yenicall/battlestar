var path = require('path'),
    cluster = require('cluster'),
    events = require('events');


function Worker(appId) {

}
Worker.prototype = new events.EventEmitter();

Worker.prototype.start = function (app) {
    if(!cluster.isMaster) {
        process.chdir(path.dirname(app));
        process.stdout.write = (function () {
            return function (string) {
                cluster.worker.process.send({
                    type: 'log:out',
                    data: string
                });
            }
        })(process.stdout.write);
        process.stderr.write = (function () {
            return function (string) {
                cluster.worker.process.send({
                    type: 'log:err',
                    data: string
                });
            }
        })(process.stderr.wrte);
        process.on('uncaughtException', function (err) {
            cluster.worker.process.send({
                type: 'log:exp',
                data: err.stack
            });
            process.emit('disconnect');
            process.exit(0);
        });
        require(app);
    }
};
module.exports = Worker;