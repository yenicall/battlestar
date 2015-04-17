var cluster = require('cluster'),
    path = require('path'),
    fs = require('fs'),
    logger = require('./../logger/index'),
    events = require('events'),
    Worker = require('./worker'),
    async = require('async'),
    extend = require('util')._extend,
    procNumber = require('os').cpus().length;

function WorkersManager(appId) {
    this._workers = {};
    this.appId = appId;
    this.version = null;
    this.env = {};
}
WorkersManager.prototype = new events.EventEmitter();

WorkersManager.prototype.setPath = function (app) {
    if (cluster.isMaster && app) {
        this.app = this._findPath(app);
    }
};

WorkersManager.prototype._findPath = function (app) {
    var prefix = (app.indexOf('/') !== 0) ? process.cwd() : '';
    app = path.join(prefix, app);
    if (fs.existsSync(app) && fs.statSync(app).isFile()) {
        return app;
    }
};

WorkersManager.prototype.setEnv = function (env) {
    logger.debug("WorkersManager " + this.appId, "Setting new env vars");
    this.env = env;
};

WorkersManager.prototype.setVersion = function (version) {
    this.version = version;
};

WorkersManager.prototype.reloadWorkers = function (callback) {
    if (cluster.isMaster) {

        var workerIds = Object.keys(this._workers);
        if (workerIds.length) {
            logger.debug("WorkersManager " + this.appId, "Reloading workers");
            return async.each(Object.keys(this._workers), function (workerId, cb) {
                var worker = cluster.workers[workerId];
                if (worker) {
                    worker.disconnect();
                    return worker.on("disconnect", function () {
                        logger.debug("WorkersManager " + this._workers[worker.id].appId, "Shutdown complete for worker");
                        this._spawnWorker();
                        cb();
                    }.bind(this));
                }
                cb();
            }.bind(this), function () {
                if (typeof callback === "function") {
                    callback();
                }
            });
        }
        this.run();
        if (typeof callback === "function") {
            callback();
        }
    }
};

WorkersManager.prototype._spawnWorker = function () {
    if (this.app && this.version) {
        logger.debug("WorkersManager " + this.appId, 'Spawning worker for ', this.appId);

        var env;
        env = extend({
            VIPER_APP_PATH: this.app,
            VIPER_APP: this.appId,
            VIPER_VERSION: this.version
        }, this.env);
        var worker = cluster.fork(env);
        this._workers[worker.id] = {
            pid: worker.process.pid,
            app: this.app,
            appId: this.appId
        };

        this._bindLog(worker);

    }
};

WorkersManager.prototype.spawnWorkers = function (number) {
    if (cluster.isMaster) {

        for (var n = 0; n < number; n += 1) {
            this._spawnWorker();
        }
        cluster.on('exit', function (worker) {
            if (this._workers[worker.id] && !worker.suicide) {
                logger.debug(this.appId + ' ' + this._workers[worker.id], 'died :( ...booting a replacement worker');
                delete this._workers[worker.id];
                this._spawnWorker();
            }
        }.bind(this));

        // Set an exit handler
        var onExit = function () {
            logger.debug("WorkersManager " + this.appId, 'Exiting, killing the workers');
            for (var id in cluster.workers) {
                var worker = cluster.workers[id];
                logger.debug("WorkersManager " + this.appId, 'Killing worker #' + worker.process.pid);
                worker.destroy();
            }
            this.emit('exit');
            process.exit(0);
        }.bind(this);

        process.on('SIGINT', onExit);
        process.on('SIGTERM', onExit);
    } else {
        var worker = new Worker(cluster.worker.process.env.VIPER_APP);
        worker.start(cluster.worker.process.env.VIPER_APP_PATH);
    }
};
WorkersManager.prototype.run = function () {
    this.spawnWorkers(procNumber);
};
WorkersManager.prototype._bindLog = function (worker) {
    worker.on('listening', function (address) {
        logger.debug('WorkerManager', 'Listening event received');
        this._workers[worker.id].port = address.port;
        this.emit('listening', this._workers[worker.id].appId, address.port, this.version);
    }.bind(this));


    worker.on('message', function (msg) {
        if (msg.type) {
            switch (msg.type) {
                case 'log:err':
                    logger.error(this.appId, msg.data.trim("\n"));
                    break;
                case 'log:out':
                    logger.info(this.appId, msg.data.trim("\n"));
                    break;
                case 'log:exp':
                    logger.error(this.appId, msg.data.trim("\n"));
            }
        }
    }.bind(this));
};

module.exports = WorkersManager;