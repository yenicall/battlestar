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
                    var appPath = path.join(process.cwd(), 'apps', doc.appId);
                    mkdirp.sync(appPath);
                    var files = fs.readdirSync(appPath);
                    for (var i = files.length - 1; i >= 0; i--) {
                        var stats = fs.statSync(path.join(appPath, files[i]));
                        if (stats.isDirectory()) {
                            break;
                        }
                    }
                    if (doc.path && doc.version) {
                        appPath = path.join(appPath, files[i], doc.path[doc.version]);
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
ApplicationManager.prototype.deploy = function (appId, version, app, file, callback) {
    this._isLoaded(function () {
        if (!this._applications[appId]) {
            return callback(true);
        }
        var appPath = path.join(process.cwd(), 'apps', appId);
        this._applications[appId].metadata.version = version;
        if (!this._applications[appId].metadata.path) {
            this._applications[appId].metadata.path = {};
        }
        this._applications[appId].metadata.path[version] = app;
        this._db.update({appId: appId}, {
            $set: {
                version: version,
                path: this._applications[appId].metadata.path
            }
        }, function (err) {
            if (err) {
                console.log(err);
                return callback(err, null);
            }
            appPath = path.join(appPath, version);
            mkdirp.sync(appPath);
            var extractor = unzip.Extract({path: appPath});
            extractor.on("error", function (err) {
                callback(err, null);
            })
                .on('close', function () {
                    this._applications[appId].workersManager.setPath(path.join(appPath, app));
                    this._applications[appId].workersManager.reloadWorkers();
                    callback(null);

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
                app.workersManager.run(procNumber);
                i++;
                if (i >= count) {
                    app.workersManager.on('listening', function (appId, port) {
                        app.port = port;
                        this.emit('listening', {appId: appId, port: port});
                    }.bind(this));
                    callback(null);
                }
            }.bind(this))(apps[app]);
        }
    });
};

ApplicationManager.prototype.setEnv = function (appId, env, callback) {
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