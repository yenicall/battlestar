var events = require('events'),
    config = require('./config')(),
    mkdirp = require('mkdirp'),
    unzip = require('unzip'),
    fs = require('fs'),
    path = require('path'),
    WorkersManager = require('./workersManager'),
    procNumber = require('os').cpus().length;

function ApplicationManager() {
    this._db = null;
    this._applications = {};
    config.once('loaded', function (db) {
        db.ensureIndex({fieldName: 'appId', unique: true});
        this._db = db;
        this._db.find({}, function (err, docs) {
            if (!err && docs) {
                docs.forEach(function (doc) {
                    this._applications[doc.appId] = {
                        metadata: doc,
                        workersManager: new WorkersManager(doc.appId)
                    };
                    var appPath;
                    if (doc.path) {
                        appPath = doc.path;
                    }
                    this._applications[doc.appId].workersManager.setPath(appPath);
                    this._applications[doc.appId].workersManager.setEnv(doc.env);

                }.bind(this));
            }
            this.emit('loaded');
        }.bind(this));

    }.bind(this));
}

ApplicationManager.prototype = new events.EventEmitter();

ApplicationManager.prototype._isLoaded = function (callback) {
    if (this._db) {
        return callback.apply(this);
    }
    this.on('loaded', function () {
        callback.apply(this);
    });
};
ApplicationManager.prototype.deploy = function (appId, version, app, env, file, callback) {
    this._isLoaded(function () {
        if (!this._applications[appId]) {
            return callback(true);
        }
        var appPath = path.join(process.cwd(), 'apps', appId);
        appPath = path.join(appPath, +Date.now());
        mkdirp.sync(appPath);
        var oldPath = null;
        if (this._applications[appId].metadata.path) {
            oldPath = this._applications[appId].metadata.path;
        }
        this._applications[appId].metadata.path = path.join(appPath, app);
        this._applications[appId].metadata.version = version;
        this._db.update({appId: appId}, {
            $set: {
                path: path.join(appPath, app),
                version: version
            }
        }, function (err) {
            if (err) {
                return callback(err, null);
            }

            var extractor = unzip.Extract({path: appPath});
            extractor.on("error", function (err) {
                callback(err, null);
            })
                .on('close', function () {
                    this.setEnv(appId, env, function () {
                        this._applications[appId].workersManager.setPath(path.join(appPath, app));
                        this._applications[appId].workersManager.setVersion(version);
                        this._applications[appId].workersManager.reloadWorkers();
                        if (oldPath) {
                            fs.rmdir(path.dirname(oldPath));
                        }
                        callback(null);
                    }.bind(this));

                }.bind(this));
            fs.createReadStream(file).pipe(extractor);
        }.bind(this));
    })
}
;


ApplicationManager.prototype.addApplication = function (doc, callback) {
    this._isLoaded(function () {
        this._db.insert(doc, function (err, doc) {
            if (err) {
                return callback(err, null);
            }
            this._applications[doc.appId] = {
                metadata: doc,
                workersManager: new WorkersManager(doc.appId)
            };
            mkdirp.sync(path.join(process.cwd(), 'apps', doc.appId));
            callback(false, doc);

        }.bind(this));
    });
};

ApplicationManager.prototype.listApplications = function (callback) {
    this._isLoaded(function () {
        callback(this._applications);
    });
};

ApplicationManager.prototype.run = function (appId, callback) {
    this._isLoaded(function () {
        var one = true;
        if (typeof appId === "function") {
            callback = appId;
            appId = null;
            one = false;
        }

        var apps = {};
        if (one) {
            if (!this._applications[appId]) {
                // return callback(true);
            }
            apps[appId] = this._applications[appId];
        } else {
            apps = this._applications;
        }

        var count = Object.keys(this._applications).length,
            i = 0;
        for (var app in apps) {
            (function (app) {
                if (app.metadata && app.metadata.env) {
                    app.workersManager.setEnv(env);
                }
                if (app.metadata && app.metadata.version) {
                    app.workersManager.setVersion(app.metadata.version);
                }
                app.workersManager.run(procNumber);
                i++;
                if (i >= count) {
                    app.workersManager.on('listening', function (appId, port, version) {
                        app.port = port;
                        this.emit('listening', {appId: appId, port: port, version: version});
                    }.bind(this));
                    callback(null);
                }
            }.bind(this))(apps[app]);
        }
    });
};

ApplicationManager.prototype.setEnv = function (appId, env, callback) {
    if (!env) {
        return callback(null);
    }
    this._isLoaded(function () {
        db.update({appId: appId}, {$set: {env: env}}, function (err) {
            if (err) {
                return callback(err);
            }
            this._applications[appId].metadata.env = env;
            this._applications[appId].workersManager.setEnv(env);
            callback(null);
        }.bind(this));

    });
};

module.exports = ApplicationManager;