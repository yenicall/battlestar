var cluster = require('cluster'),
    path = require('path'),
    fs = require('fs'),
    logger = require('./../logger/index'),
    events = require('events'),
    Worker = require('./worker'),
    extend = require('util')._extend;

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
    console.log(app);
    if (fs.existsSync(app) && fs.statSync(app).isFile()) {
        return app;
    }
};

WorkersManager.prototype.setEnv = function (env) {
    if (cluster.isMaster) {
        logger.debug("WorkersManager " + this.appId, "Setting new env vars");
        if (env) {
            this.env = env;
        }
        this.reloadWorkers();
    }

};

WorkersManager.prototype.setVersion = function (version) {
    this.version = version;
};

WorkersManager.prototype.reloadWorkers = function () {
    if (cluster.isMaster) {
        logger.debug("WorkersManager " + this.appId, "Reloading workers");
        for (var workerId in this._workers) {
            (function (worker) {
                worker.disconnect();
                worker.on("disconnect", function () {
                    logger.debug("WorkersManager " + this._workers[worker.id].appId, "Shutdown complete for worker");
                    this._spawnWorker();
                }.bind(this))
            }.bind(this))(cluster.workers[workerId]);
        }
    }
};

WorkersManager.prototype._spawnWorker = function () {
    if (this.app && this.version) {
        logger.debug("WorkersManager " + this.appId, 'Spawning worker for ', this.appId);
        var env = extend(this.env, {
            VIPER_APP_PATH: this.app,
            VIPER_APP: this.appId,
            VIPER_VERSION: this.version
        });
        var worker = cluster.fork(env);
        this._workers[worker.id] = {
            pid: worker.process.pid,
            app: this.app,
            appId: this.appId,
            position: Object.keys(this._workers).length + 1
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
                logger.debug(this.appId + ' ' + this._workers[worker.id].position, 'died :( ...booting a replacement worker');
                delete this._workers[worker.id];
                this._spawnWorker();
            }
        }.bind(this));

        // Set an exit handler
        var onExit = function () {
            logger.info("WorkersManager " + this.appId, 'Exiting, killing the workers');
            for (var id in cluster.workers) {
                var worker = cluster.workers[id];
                logger.info("WorkersManager " + this.appId, 'Killing worker #' + worker.process.pid);
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
WorkersManager.prototype.run = function (number) {
    this.spawnWorkers(number);
};
WorkersManager.prototype._bindLog = function (worker) {
    worker.on('listening', function (address) {
        this._workers[worker.id].port = address.port;
        this.emit('listening', this._workers[worker.id].appId, address.port, this.version);
    }.bind(this));

    worker.on('message', function (msg) {
        if (msg.type) {
            switch (msg.type) {
                case 'log:err':
                    logger.error(this.appId + ' ' + this._workers[worker.id].position, msg.data.trim("\n"));
                    break;
                case 'log:out':
                    logger.info(this.appId + ' ' + this._workers[worker.id].position, msg.data.trim("\n"));
                    break;
                case 'log:exp':
                    logger.error(this.appId + ' ' + this._workers[worker.id].position, msg.data.trim("\n"));
            }
        }
    }.bind(this));
};

module.exports = WorkersManager;