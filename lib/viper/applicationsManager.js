var events = require('events'),
    config = require('./config')(),
    tar = require('tar-fs'),
    fs = require('fs'),
    fse = require('fs-extra'),
    path = require('path'),
    logger = require('../logger'),
    child_process = require('child_process'),
    WorkersManager = require('./workersManager'),
    extend = require('util')._extend,
    async = require('async');

require('shelljs/global');

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
ApplicationManager.prototype.deploy = function (appId, version, env, file, callback) {
    this._isLoaded(function () {
        var self = this,
            deploy = function () {
                var appPath = path.join(process.cwd(), 'apps', appId),
                    cache = path.join(appPath, 'cache'),
                    pathFile;
                appPath = path.join(appPath, Date.now().toString());
                fse.mkdirsSync(appPath);

                var extract = tar.extract(appPath);
                extract
                    .on('error', callback)
                    .on('finish', function () {
                        fs.readdir(appPath, function (err, files) {
                            if (err) {
                                return cb(err);
                            }
                            var useNpm = false, useBower = false, useGrunt = false, useGulp = false,
                                toLowerCase = String.prototype.toLowerCase.call.bind(String.prototype.toLowerCase);
                            files = files.map(toLowerCase);

                            logger.debug('Viper', 'Package extract finding conf file', appId);
                            logger.info(appId, 'Start compiling package');

                            if (files.indexOf('battlestar.json') === -1) {

                                logger.error(appId, 'Compilation failed, missing battlestar.json');
                                return cb(new restify.MissingParameterError('battlestar.json_notfound'));
                            }
                            try {
                                var config = JSON.parse(fs.readFileSync(path.join(appPath, 'battlestar.json'), "UTF-8"));
                            } catch (e) {
                                return cb(new restify.MissingParameterError('battlestar.json_invalid'));
                            }
                            if (config.app) {
                                pathFile = path.join(appPath, config.app);
                            }
                            logger.debug('Viper', appId, 'finding bower');
                            if (files.indexOf('bower.json') !== -1) {
                                useBower = which('bower');
                                if (!useBower) {
                                    logger.warn('Viper', 'bower.json found but bower seems not be installed');
                                } else {
                                    logger.debug('Viper', appId, 'bower found');
                                }
                            }

                            logger.debug('Viper', appId, 'finding grunt');
                            if (files.indexOf('gruntfile.js') !== -1 || files.indexOf('gruntfile.coffee') !== -1) {
                                useGrunt = which('grunt')  && config.grunt;
                                if (!useGrunt) {
                                    logger.warn('Viper', 'gruntfile found but grunt seems not be installed');
                                } else {
                                    logger.debug('Viper', appId, 'grunt found');
                                }
                            }

                            logger.debug('Viper', appId, 'finding npm');
                            if (files.indexOf('package.json') !== -1) {
                                useNpm = which('npm');
                                if (!useNpm) {
                                    logger.warn('Viper', 'package.json found but npm seems not be installed');
                                } else {
                                    logger.debug('Viper', appId, 'npm found');
                                }
                            }

                            var cmds = [];

                            function exec(cmd, args, opts) {
                                return function (callback) {
                                    if (!opts) {
                                        opts = {};
                                    }
                                    if (opts.env) {
                                        extend(opts.env, process.env);
                                    }
                                    var cp = child_process.spawn(cmd, args, opts);
                                    cp.stdout.on('data', function (data) {
                                        logger.info(appId, data.toString());
                                    });
                                    cp.stderr.on('data', function (data) {
                                        logger.error(appId, data.toString());
                                    });
                                    cp.on('close', function (code) {
                                        logger.debug('ApplicationManager', appId, 'cmd :', cmd, 'code', code);
                                        callback(code!==0);
                                    })
                                }
                            }

                            function execBower(callback) {
                                async.series([
                                    function (callback) {
                                        logger.debug("Viper", appId, "Copying bower.json to cache path");
                                        fse.copy(path.join(appPath, 'bower.json'), path.join(cache, 'bower.json'), callback);
                                    },
                                    exec('bower', ['prune'], {cwd: cache, env: env}),
                                    exec('bower', ['install'], {
                                        cwd: cache,
                                        env: env
                                    }),
                                    function (callback) {
                                        logger.debug("Viper", appId, "Starting copy of bower_components from cache to app dir");
                                        fse.copy(path.join(cache, 'bower_components'), path.join(appPath, 'bower_components'), function (err) {
                                            logger.debug("Viper", appId, "Copied bower_components from cache to app dir");
                                            callback(err);
                                        });
                                    }
                                ], function (err) {
                                    callback(err);
                                });
                            }

                            function execNpm(callback) {
                                async.series([
                                    function (callback) {
                                        logger.debug("Viper", appId, "Copying package.json to cache path");
                                        fse.copy(path.join(appPath, 'package.json'), path.join(cache, 'package.json'), callback);

                                    },
                                    exec('npm', ['prune'], {cwd: cache, env: env}),
                                    exec('npm', ['install'], {cwd: cache, env: env}),
                                    function (callback) {
                                        logger.debug("Viper", appId, "Starting copy of node_modules from cache to app dir");
                                        fse.copy(path.join(cache, 'node_modules'), path.join(appPath, 'node_modules'), function (err) {
                                            logger.debug("Viper", appId, "Copied node_modules from cache to app dir");
                                            callback(err);
                                        });
                                    }
                                ], function (err) {
                                    callback(err);
                                });
                            }

                            function execGrunt(callback) {
                                var params = [];
                                if (config.grunt) {
                                    params.push(config.grunt);
                                }
                                logger.debug("Viper", appId, "Running grunt with the task", (params.length ? params[0] : "default"));
                                async.series([exec('grunt', params, {cwd: appPath, env: env})], function (err) {
                                    logger.debug("Viper", appId, "Grunt task executed");
                                    callback(err);
                                });
                            }


                            if (useBower) {
                                cmds.push(execBower);
                            }

                            if (useNpm) {
                                cmds.push(execNpm);
                            }

                            if (useGrunt) {
                                cmds.push(execGrunt);
                            }


                            cmds.push(function (callback) {
                                fse.remove(file, callback);
                            });

                            async.series(cmds, function (err) {
                                if(err){
                                    return callback(err);
                                }
                                var oldPath = null;
                                if (self._applications[appId].metadata.path) {
                                    oldPath = self._applications[appId].metadata.path;
                                }
                                self._applications[appId].metadata.path = pathFile;
                                self._applications[appId].metadata.version = version;
                                self._db.update({appId: appId}, {
                                    $set: {
                                        path: pathFile,
                                        version: version
                                    }
                                }, function (err) {
                                    if (err) {
                                        return callback(err, null);
                                    }

                                    self.setEnv(appId, env, function () {
                                        self._applications[appId].workersManager.setPath(pathFile);
                                        self._applications[appId].workersManager.setVersion(version);
                                        self._applications[appId].workersManager.reloadWorkers(function () {
                                            if (oldPath) {
                                                return fse.remove(path.dirname(oldPath), callback);
                                            }
                                            callback(null);
                                        });
                                    });
                                });
                            });
                        });
                    });
                fs.createReadStream(file).pipe(extract);
            };
        if (!this._applications[appId]) {
            return this.addApplication({appId: appId}, deploy);
        }
        deploy();
    });
};


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
            fse.mkdirsSync(path.join(process.cwd(), 'apps', doc.appId, 'cache'));
            callback(false, doc);

        }.bind(this));
    });
};

ApplicationManager.prototype.listApplications = function (callback) {
    this._isLoaded(function () {
        var apps = {};
        for (var appId in this._applications) {
            apps[appId] = this._applications[appId].metadata;
        }
        callback(apps);
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
        async.each(Object.keys(apps), function (appKey, cb) {
            var app = apps[appKey];
            if (!app.metadata || !app.metadata.path || !fs.existsSync(app.metadata.path)) {
                return;
            }
            app.workersManager.setPath(app.metadata.path);
            if (app.metadata && app.metadata.env) {
                app.workersManager.setEnv(app.metadata.env);
            }

            if (app.metadata && app.metadata.version) {
                app.workersManager.setVersion(app.metadata.version);
            }
            app.workersManager.run();
            app.workersManager.on('listening', function (appId, port, version) {
                app.port = port;
                this.emit('listening', {appId: appId, port: port, version: version});
            }.bind(this));
            cb();
        }.bind(this), function () {
            callback(null);
        });
    });
};

ApplicationManager.prototype.setEnv = function (appId, env, callback) {
    if (!env) {
        return callback(null);
    }
    this._isLoaded(function () {
        this._db.update({appId: appId}, {$set: {env: env}}, function (err) {
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