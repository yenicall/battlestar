var cluster = require('cluster'),
    path = require('path'),
    fs = require('fs'),
    logger = require('./logger'),
    events = require('events'),
    Worker = require('./worker');

function WorkersManager(appId, app) {
    this._workers = {};
    this.app = this._findPath(app);

    this.appId = appId;
}
WorkersManager.prototype = new events.EventEmitter();
WorkersManager.prototype._findPath = function (app) {
    var prefix = (app.indexOf('/') !== 0) ? process.cwd() : '';
    app = path.join(prefix, app);
    if (fs.existsSync(app)) {
        return app;
    } else {
        throw new Error('Cannot find required app');
    }
};
WorkersManager.prototype.spawnWorkers = function (number) {
    if (cluster.isWorkersManager) {
        var spawnWorker = function () {
            var worker = cluster.fork();
            this._workers[worker.id] = {
                state: 'running',
                pid: worker.process.pid
            };
            this._bindLog(worker);
        }.bind(this);

        for (var n = 0; n < number; n += 1) {
            logger.debug('WorkersManager', 'Spawning worker #', n, ' for ', this.appId);
            spawnWorker();
        }
        cluster.on('exit', function (worker) {

            if (this._workers[worker.id] && !worker.suicide) {
                logger.info('Worker ' + worker.process.pid, 'died :( ...booting a replacement worker');
                console.log(this._workers, this.app, this.appId);
                delete this._workers[worker.id];
                spawnWorker();
            }
        }.bind(this));

        // Set an exit handler
        var onExit = function () {
            this.emit('exit');
            logger.info('WorkersManager', 'Exiting, killing the workers');
            for (var id in this._workers) {
                var worker = cluster.workers[id];
                logger.info('WorkersManager', 'Killing worker #' + worker.process.pid);
                worker.destroy();
            }
            process.exit(0);
        }.bind(this);

        process.on('SIGINT', onExit);
        process.on('SIGTERM', onExit);
    } else {
        var worker = new Worker(this.appId);
        worker.start(this.app);
    }
};
WorkersManager.prototype.run = function (number) {
    this.spawnWorkers(number);
};
WorkersManager.prototype._bindLog = function (worker) {
    worker.on('message', function (msg) {
        if (msg.type) {
            switch (msg.type) {
                case 'log:err':
                    logger.error(this.appId + ' ' + worker.id, msg.data.trim("\n"));
                    break;
                case 'log:out':
                    logger.info(this.appId + ' ' + worker.id, msg.data.trim("\n"));
                    break;
                case 'log:exp':
                    logger.error(this.appId + ' ' + worker.id, msg.data.trim("\n"));
            }
        }
    }.bind(this));
};
/*
 WorkersManager.prototype._findPath = function(app) {
 if (fs.existsSync(app)) {
 this.app= path.resolve(app);
 }
 this.app= path.join(process.cwd(), app);
 };

 WorkersManager.prototype._bindLog =function(worker) {
 worker.on('message', function (msg) {
 if (msg.type) {
 switch (msg.type) {
 case 'log:err':
 logger.error('Worker ' + worker.process.pid, msg.data.trim("\n"));
 break;
 case 'log:out':
 logger.info('Worker ' + worker.process.pid, msg.data.trim("\n"));
 break;
 case 'log:exp':
 logger.error('Worker ' + worker.process.pid, msg.data.trim("\n"));
 }
 }
 });
 };

 WorkersManager.prototype.start=function(noOfWorkers, app) {
 app = findPath(app);
 var proc;
 if (cluster.isWorkersManager) {
 for (var i = 0; i < noOfWorkers; i += 1) {
 bindLog(cluster.fork({
 test: 'm'
 }));
 }
 cluster.on('exit', function (worker) {
 // A suicide means we shutdown the worker on purpose
 // like in a deployment
 if (!worker.suicide) {
 logger.info('Worker ' + worker.process.pid, 'died :( ...booting a replacement worker');
 bindLog(cluster.fork());
 }
 });

 process.on('SIGUSR2', function () {
 delete require.cache[app];
 var workers = Object.keys(cluster.workers);
 reloadWorkers(workers);
 });
 } else {
 proc = cluster.worker.process;
 logger.info('Worker ' + proc.pid, 'running!');
 proc.stdout.write = (function (write) {
 return function (string, encoding, fd) {
 proc.send({
 type: 'log:out',
 data: string
 });
 }
 })(proc.stdout.write);
 proc.stderr.write = (function (write) {
 return function (string, encoding, fd) {
 proc.send({
 type: 'log:err',
 data: string
 });
 }
 })(proc.stderr.wrte);
 proc.on('uncaughtException', function (err) {
 logger.warn('Worker ' + proc.pid, 'Caught exception : ', err);
 proc.send({
 type: 'log:exp',
 data: err.stack
 });
 proc.emit('disconnect');
 proc.exit(0);
 });
 require(app);
 }
 };
 Worker(workerKey, callback) {
 cluster.workers[workerKey].disconnect();
 cluster.workers[workerKey].on("disconnect", function () {
 logger.debug("WorkersManager", "Shutdown complete for worker " + workerKey);
 callback();
 });
 }

 function reloadWorkers(workers) {
 logger.info('WorkersManager', '*** reloading workers!');
 var workerKey = workers.shift();

 logger.info('WorkersManager', 'restarting worker: ' + workerKey);

 stopWorker(workerKey, function () {
 var newWorker = cluster.fork({
 test2: 'toi'
 });
 bindLog(newWorker);
 newWorker.on("listening", function () {
 logger.debug("WorkersManager", "Replacement worker online.");
 if (workers.length > 0) {
 reloadWorkers(workers);
 }
 });
 });
 }
 function gracefulShutdown() {
 logger.debug("WorkersManager", '*** shutting down gracefully');
 var workers = Object.keys(cluster.workers);
 shutdownWorkers(workers);
 }
 function shutdownWorkers(workers) {
 var workerKey = workers.shift();

 logger.debug('WorkersManager', 'shutting down worker: ' + workerKey);

 stopWorker(workerKey, function () {
 if (workers.length > 0) {
 shutdownWorkers(workers);
 } else {
 process.exit();
 }
 });
 }



 WorkersManager.prototype.*/

module.exports = WorkersManager;