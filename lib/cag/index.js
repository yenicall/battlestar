var path = require('path'),
    config = {},
    logger = require('../logger'),
    restify = require('restify'),
    Datastore = require('nedb'),
    dns = require('dns'),
    async = require('async'),
    Redis = require('redis'),
    fs = require('fs'),
    restler = require('restler'),
    child_process = require('child_process'),
    tmpDir = require('os').tmpdir(),
    fse = require('fs-extra'),
    tar = require('tar-fs'),
    extend = require('util')._extend,
    db = {
        applications: new Datastore(path.join(process.cwd(), 'applications.db')),
        hosts: new Datastore(path.join(process.cwd(), 'hosts.db'))
    };
require('shelljs/global');


try {
    config = require(path.join(process.cwd(), 'config.json'));
} catch (e) {
}
logger.level = (config.logLevel || 'INFO').toUpperCase();
try {
    fs.mkdirSync(path.join(process.cwd(), 'apps'));
} catch (e) {

}

db.applications.loadDatabase(function () {
    db.hosts.loadDatabase(function () {
        db.applications.ensureIndex({fieldName: 'appId', unique: true});
        main();
    })
});
function main() {
    var redis = Redis.createClient();
    var server = restify.createServer({
        name: 'CAG'
    });


    //Helpers
    function updateLoadBalancer(appId, callback) {
        db.applications.findOne({appId: appId}, function (err, doc) {
            redis.del('frontend:' + doc.hostname, function () {
                redis.rpush('frontend:' + doc.hostname, doc.appId, function () {
                    //If use all available hosts
                    logger.debug("CAG", doc.loadBalancerHosts);
                    async.each(doc.loadBalancerHosts, function (host, cb) {
                        redis.rpush('frontend:' + doc.hostname, 'http://' + host.host + ':' + host.port, cb);
                    }, callback);
                });
            });
        });
    }

    function deployApp(appId, hosts) {
        db.applications.findOne({appId: appId}, function (err, doc) {
            var packagePath = path.join(process.cwd(), 'apps', doc.appId),
                pkg = path.join(packagePath, doc.version + ".tar");
            fs.exists(pkg, function (exists) {
                if (exists) {
                    logger.info(doc.appId, "Deploying version", doc.version);

                    logger.debug('CAG', 'Finding available hosts for', doc.appId);
                    // db.hosts.find({}, function (err, hosts) {
                    var uploadHosts = [];
                    //   if (doc.hosts) {
                    //     doc.hosts.forEach(function (availableHost) {
                    hosts.forEach(function (host) {
                        //     if (availableHost.host === host.host) {
                        uploadHosts.push("http://" + host.host + ":" + host.port);
                        return false;
                        //   }
                        //       });
                    });
                    //} else {
                    //  hosts.forEach(function (host) {
                    //    uploadHosts.push("http://" + host.host + ":" + host.port);
                    //});
                    //}
                    logger.debug("CAG", "Number of hosts found", uploadHosts.length, 'hosts : ', uploadHosts);
                    if (uploadHosts.length) {
                        fs.stat(pkg, function (err, stats) {
                            var file = restler.file(pkg, null, stats.size, null, 'application/tar');

                            async.each(uploadHosts, function (url, cb) {
                                logger.debug('CAG', 'deploy on', url);
                                restler.post(url + "/apps/" + appId, {
                                    multipart: true,
                                    data: {
                                        version: doc.version,
                                        app: doc.apps[doc.version - 1],
                                        env: JSON.stringify(doc.envs[doc.version - 1]),
                                        package: file
                                    }
                                })
                                    .on('error', cb)
                                    .on('complete', function (err) {
                                        if (err) {
                                            return cb(err);
                                        }
                                        logger.debug("CAG", "Application deployed on", url);
                                        cb();
                                    })
                            }, function (err) {
                                if (err) {
                                    logger.error(appId, 'Deployed failed', err);
                                } else {
                                    logger.info(appId, "Application deployed on all hosts");
                                }
                            });
                        })
                    }
                    //});
                }
            });
        });
    }

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.queryParser());
    server.use(restify.bodyParser({mapParams: false}));


    server.post('/logs', function (req, res) {
        logger[req.body.level.toLowerCase()](req.body.section, req.body.logs);
        res.json(201);
    });

    server.post('/vipers', function (req, res) {
        db.hosts.findOne({host: req.body.ip}, function (err, doc) {
            logger.debug("CAG", "A new Viper request");
            var send = function () {
                res.json(201);
            };
            if (err || !doc) {
                logger.debug("CAG", "A new viper in the squad - ip", req.body.ip, "port", req.body.port);
                return db.hosts.insert({
                    host: req.body.ip,
                    port: req.body.port
                }, send);
            }
            //Update port if different
            if (doc.port !== parseInt(req.body.port)) {
                logger.debug("CAG", "Updating a viper in the squad - ip", req.body.ip, "port", req.body.port);
                return db.hosts.update({host: req.body.ip}, {$set: {port: req.body.port}}, send);
            }
            if (req.body.apps && Object.keys(req.body.apps).length) {
                deployApps(Object.keys(req.body.apps));
            } else {
                db.applications.find({}, function (err, docs) {
                    var appIds = docs.map(function (doc) {
                        return doc.appId;
                    });
                    deployApps(appIds);
                })
            }
            function deployApps(appIds) {
                async.each(appIds, function (appId, callback) {
                    db.applications.find({appId: appId}, function (err, doc) {
                        db.hosts.find({}, function (err, hosts) {
                            var uploadHosts = [];
                            if (doc.hosts) {
                                doc.hosts.forEach(function (availableHost) {
                                    hosts.forEach(function (host) {
                                        if (availableHost.host === host.host) {
                                            uploadHosts.push(host);
                                            return false;
                                        }
                                    });
                                });
                            } else {
                                hosts.forEach(function (host) {
                                    uploadHosts.push(host);
                                });
                            }
                            deployApp(appId, uploadHosts);
                            callback();
                        });
                    });
                }, function () {
                });
            }

            send();
        })
    });

    server.put('/apps', function (req, res, next) {
        if (!req.body || !req.body.appId) {
            return next(new restify.MissingParameterError('appId'));
        }
        if (!req.body || !req.body.hostname) {
            return next(new restify.MissingParameterError('hostname'));
        }
        db.applications.findOne({appId: req.body.appId}, function (err, doc) {
            if (err || doc) {
                return next(new restify.InvalidArgumentError('appId already exists'));
            }
            try {
                fse.mkdirsSync(path.join(process.cwd(), 'apps', req.body.appId, 'cache'));
            } catch (e) {

            }
            logger.info("CAG", "Adding an application", req.body.appId);
            var newDoc = {
                appId: req.body.appId,
                hostname: req.body.hostname,
                version: 0,
                envs: [],
                apps: []
            };
            var insert = function () {
                db.applications.insert(newDoc);
                res.json(201);
            };
            if (req.body && Array.isArray(req.body.hosts)) {
                newDoc.hosts = [];
                async.each(req.body.hosts, function (host, cb) {
                    dns.lookup(host, function (err, ip) {
                        if (!err) {
                            newDoc.hosts.push({
                                host: ip,
                                port: 0
                            });
                        }
                        cb();
                    });
                }, insert);
            } else {
                insert();
            }


        });
    });

    server.post('/apps/:appId/rollback', function (req, res, next) {
        if (!req.body && !req.body.version) {
            return next(new restify.MissingParameterError('missing version'));
        }

        db.applications.findOne({appId: req.params.appId}, function (err, doc) {
            if (err || !doc) {
                return next(new restify.InvalidArgumentError('appId'));
            }
            var version = parseInt(req.body.version, 10);
            if (version > doc.version) {
                return next(new restify.InvalidArgumentError('version'));
            }
            logger.info(doc.appId, "Rolling back to version", version);
            db.applications.update({appId: doc.appId}, {$set: {version: version}}, function () {
                db.hosts.find({}, function (err, hosts) {
                    var uploadHosts = [];
                    if (doc.hosts) {
                        doc.hosts.forEach(function (availableHost) {
                            hosts.forEach(function (host) {
                                if (availableHost.host === host.host) {
                                    uploadHosts.push(host);
                                    return false;
                                }
                            });
                        });
                    } else {
                        hosts.forEach(function (host) {
                            uploadHosts.push(host);
                        });
                    }
                    deployApp(req.params.appId, uploadHosts);
                    res.json({version: version});
                });
            });
        });
    });

    server.put('/apps/:appId', function (req, res, next) {
        if (!req.body && !req.files) {
            return next(new restify.MissingParameterError('missing body or file'));
        }

        db.applications.findOne({appId: req.params.appId}, function (err, doc) {
            if (err || !doc) {
                return next(new restify.InvalidArgumentError('appId not exists'));
            }
            doc.version = doc.envs.length + 1;
            var packagePath = path.join(process.cwd(), 'apps', doc.appId);
            var updateQuery = {$inc: {version: 1}, $set: {}};

            //Update hosts
            function updateHosts(cb) {
                if (!req.body || !req.body.hosts) {
                    return cb();
                }

                if (!req.body.hosts) {
                    updateQuery['$unset'] = {hosts: true};
                    updateHostname();
                } else {
                    if (Array.isArray(req.body.hosts)) {
                        var hosts = [];
                        async.each(req.body.hosts, function (host, cbEach) {
                            dns.lookup(host, function (err, ip) {
                                if (!err) {
                                    hosts.push({
                                        host: ip,
                                        port: 0
                                    });
                                }
                                cbEach();
                            })
                        }, function () {
                            updateQuery.$set.hosts = hosts;
                            cb();
                        });
                    } else {
                        cb();
                    }
                }

            }

            function updateHostname(cb) {
                if (req.body && req.body.hostname) {
                    updateQuery.$set.hostname = req.body.hostname;
                }
                cb();
            }

            function updatePackage(cb) {
                if (!updateQuery.$push) {
                    updateQuery.$push = {};
                }
                if (!req.files || !req.files.package) {
                    if (doc.apps && doc.apps.length) {
                        updateQuery.$push.apps = doc.apps[doc.apps.length - 1];
                    } else {
                        updateQuery.$push.apps = "";
                    }
                    return cb();
                }
                var tmpPath = path.join(tmpDir, 'cag_' + Math.random().toString(36));

                var extract = tar.extract(tmpPath);
                extract
                    .on('error', cb)
                    .on('finish', function () {
                        fs.readdir(tmpPath, function (err, files) {
                            if (err) {
                                return cb(err);
                            }
                            var useNpm = false, useBower = false, useGrunt = false, useGulp = false,
                                toLowerCase = String.prototype.toLowerCase.call.bind(String.prototype.toLowerCase);
                            files = files.map(toLowerCase);

                            logger.debug('CAG', 'Package extract finding conf file', doc.appId);
                            logger.info(doc.appId, 'Start compiling package');

                            if (files.indexOf('battlestar.json') === -1) {

                                logger.error(doc.appId, 'Compilation failed, missing battlestar.json');
                                return cb(new restify.MissingParameterError('battlestar.json_notfound'));
                            }
                            try {
                                var config = JSON.parse(fs.readFileSync(path.join(tmpPath, 'battlestar.json'), "UTF-8"));
                            } catch (e) {
                                return cb(new restify.MissingParameterError('battlestar.json_invalid'));
                            }
                            if (config.app) {
                                updateQuery.$push.apps = config.app;
                            }
                            logger.debug('CAG', doc.appId, 'finding bower');
                            if (files.indexOf('bower.json') !== -1) {
                                useBower = which('bower');
                                if (!useBower) {
                                    logger.warn('CAG', 'bower.json found but bower seems not be installed');
                                } else {
                                    logger.debug('CAG', doc.appId, 'bower found');
                                }
                            }

                            logger.debug('CAG', doc.appId, 'finding grunt');
                            if (files.indexOf('gruntfile.js') !== -1 || files.indexOf('gruntfile.coffee') !== -1) {
                                useGrunt = which('grunt');
                                if (!useGrunt) {
                                    logger.warn('CAG', 'gruntfile found but grunt seems not be installed');
                                } else {
                                    logger.debug('CAG', doc.appId, 'grunt found');
                                }
                            }

                            logger.debug('CAG', doc.appId, 'finding npm');
                            if (files.indexOf('package.json') !== -1) {
                                useNpm = which('npm');
                                if (!useNpm) {
                                    logger.warn('CAG', 'package.json found but npm seems not be installed');
                                } else {
                                    logger.debug('CAG', doc.appId, 'npm found');
                                }
                            }

                            var cmds = [];

                            var childOptions = {
                                cwd: tmpPath
                            };

                            function exec(cmd, args,opts) {
                                return function (callback) {
                                    if (!opts) {
                                        opts = childOptions;
                                    }
                                    var cp = child_process.spawn(cmd, args,opts);
                                    cp.stdout.on('data',function(data){
                                        logger.info(doc.appId, data.toString());
                                    });
                                    cp.stderr.on('data',function(data){
                                        logger.error(doc.appId,data.toString());
                                    });
                                    cp.on('close',function(code){
                                        callback(!code);
                                    })
                                }
                            }

                            var cachePath = path.join(packagePath, 'cache');

                            function execBower(callback) {
                                async.series([
                                    function (callback) {
                                        fse.copy(path.join(tmpPath, 'bower.json'), path.join(cachePath, 'bower.json'), callback);
                                    },
                                    exec('bower',['prune'], {cwd: cachePath}),
                                    exec('bower',['install'], {cwd: cachePath}),
                                    function (callback) {
                                        fse.copy(path.join(cachePath, 'bower_components'), path.join(tmpPath, 'bower_components'), callback);
                                    }
                                ], function (err) {
                                    callback(err);
                                });
                            }

                            function execNpm(callback) {
                                async.series([
                                    function (callback) {
                                        logger.debug("CAG", "Copying package.json to cache path");
                                        fse.copy(path.join(tmpPath, 'package.json'), path.join(cachePath, 'package.json'), callback);

                                    },
                                    exec('npm', ['prune'], {cwd: cachePath}),
                                    exec('npm',['install'], {cwd: cachePath}),
                                    function (callback) {
                                        logger.debug("CAG", "Starting copy of node_modules from cache to temp dir");
                                        fse.copy(path.join(cachePath, 'node_modules'), path.join(tmpPath, 'node_modules'), function (err) {
                                            logger.debug("CAG", "Copied node_modules from cache to temp dir");
                                            callback(err);
                                        });
                                    }
                                ], function (err) {
                                    callback(err);
                                });
                            }

                            function execGrunt() {
                                return exec('grunt',[], childOptions);
                            }

                            function makePackage(callback) {
                                tar.pack(tmpPath, {
                                    ignore: function (name) {
                                        if (!config.ignores || !config.ignores.length) {
                                            return false;
                                        }
                                        for (var i = 0, _len = config.ignores.length; i < _len; i++) {
                                            var ignore = config.ignores[i].replace('.', '\\.').replace('\\', '\\\\'),
                                                regExp = new RegExp(ignore);
                                            if (regExp.test(name)) {
                                                return true;
                                            }
                                        }
                                        return false;
                                    }
                                })
                                    .pipe(fs.createWriteStream(path.join(packagePath, (doc.version) + ".tar")))
                                    .on('error', callback)
                                    .on('finish', callback);

                            }

                            if (useBower) {
                                cmds.push(execBower);
                            }

                            if (useNpm) {
                                cmds.push(execNpm);
                            }

                            if (useGrunt) {
                                cmds.push(execGrunt())
                            }
                            cmds.push(makePackage);


                            cmds.push(function (callback) {
                                fse.remove(tmpPath, function () {
                                    callback();
                                });
                            });

                            cmds.push(function (callback) {
                                fse.remove(req.files.package.path, function () {
                                    callback();
                                });
                            });
                            async.series(cmds, function (err) {
                                console.log(err);
                                cb(err);
                            });
                        });
                    });
                fs.createReadStream(req.files.package.path).pipe(extract);
            }

            function updateEnv(cb) {
                if (!updateQuery.$push) {
                    updateQuery.$push = {};
                }
                if (!req.body.envs || !req.body.envs.mode || !req.body.envs.data) {
                    if (doc.envs && doc.envs.length) {
                        updateQuery.$push.envs = doc.envs[doc.envs.length - 1];
                    } else {
                        updateQuery.$push.envs = {};
                    }
                    return cb();
                }

                switch (req.body.envs.mode) {
                    case "set":
                        if (!doc.envs[doc.version - 2]) {
                            updateQuery.$push.envs = req.body.envs.data;
                        } else {
                            updateQuery.$push.envs = extend(doc.envs[doc.version - 2], req.body.envs.data);
                        }
                        break;
                    case "del":
                        if (doc.envs[doc.version - 2]) {
                            req.body.envs.data.forEach(function (env) {
                                delete doc.envs[doc.version - 2][env];
                            });
                            updateQuery.$push.envs = doc.envs[doc.version - 2];
                        }
                        break;
                    default:
                        return cb(new restify.InvalidArgumentError('envs_mode'));
                }


                //Do we have a current zip ?
                fs.exists(path.join(packagePath, (doc.version) + ".tar"), function (found) {
                    //Yes then update
                    if (found) {
                        return cb();
                    }
                    fs.exists(path.join(packagePath, (doc.version - 1) + ".tar"), function (found) {
                        //No -1
                        if (!found) {
                            return cb();
                        }

                        var oldVersion = fs.createReadStream(path.join(packagePath, (doc.version - 1) + ".tar"));
                        oldVersion.on("error", cb);
                        var newVersion = fs.createWriteStream(path.join(packagePath, (doc.version) + ".tar"));
                        newVersion.on("error", cb);
                        newVersion.on("close", cb);
                        oldVersion.pipe(newVersion);

                    });
                });
            }

            function update(cb) {
                //If no update need then do nothing
                db.applications.update({appId: req.params.appId}, updateQuery, function () {
                    db.hosts.find({}, function (err, hosts) {
                        var uploadHosts = [];
                        if (doc.hosts) {
                            doc.hosts.forEach(function (availableHost) {
                                hosts.forEach(function (host) {
                                    if (availableHost.host === host.host) {
                                        uploadHosts.push(host);
                                        return false;
                                    }
                                });
                            });
                        } else {
                            hosts.forEach(function (host) {
                                uploadHosts.push(host);
                            });
                        }
                        deployApp(req.params.appId, uploadHosts);
                        cb();
                    });

                })
            }

            async.series([
                updateHosts,
                updateHostname,
                updatePackage,
                updateEnv,
                update
            ], function (err) {
                next.ifError(err);
                logger.info(req.params.appId, "Application deployed");
                res.json(201);
            })
        });

    });

    server.post('/apps/:appId', function (req, res, next) {
        if (!req.body || !req.body.port) {
            return next(new restify.MissingParameterError('port'));
        }
        if (!req.body || !req.body.version) {
            return next(new restify.MissingParameterError('version'));
        }
        db.applications.findOne({appId: req.params.appId}, function (err, doc) {
            if (err || !doc) {
                return next(new restify.InvalidArgumentError('appId not exists'));
            }
            if (doc.version !== req.body.version) {
                return next(new restify.InvalidArgumentError('wrong version'));
            }
            logger.debug("CAG", "port update");
            //Do we need to update the load balancer configuation ?
            var needToUpdate = false, i, _len;
            if (!doc.loadBalancerHosts) {
                if (!doc.hosts) {
                    doc.loadBalancerHosts = [{host: req.body.ip, port: req.body.port}];
                    needToUpdate = true;
                } else {
                    doc.hosts.forEach(function (host) {
                        if (host.host === req.body.ip) {
                            doc.loadBalancerHosts = [{host: req.body.ip, port: req.body.port}];
                            needToUpdate = true;
                            return false;
                        }
                    });
                }
            } else {
                if (!doc.hosts) {
                    for (i = 0, _len = doc.loadBalancerHosts.length; i < _len; i++) {
                        if (doc.loadBalancerHosts[i].host === req.body.ip) {
                            if (doc.loadBalancerHosts[i].port !== req.body.port) {
                                doc.loadBalancerHosts[i].port = req.body.port;
                                needToUpdate = true;
                            }
                            break;
                        }
                    }
                } else {
                    var found = false;
                    for (i = 0, _len = doc.loadBalancerHosts.length; i < _len; i++) {
                        if (doc.loadBalancerHosts[i].host === req.body.ip) {
                            doc.hosts.forEach(function (host) {
                                if (host.host === req.body.ip) {
                                    found = true;
                                    return false;
                                }
                            });
                            //The host is not allowed anymore, remove it
                            if (!found) {
                                needToUpdate = true;
                                break;
                            }
                            if (doc.loadBalancerHosts[i].port !== req.body.port) {
                                doc.loadBalancerHosts[i].port = req.body.port;
                                needToUpdate = true;
                            }
                            break;
                        }
                    }
                    if (!found) {
                        doc.loadBalancerHosts = [].slice.call(doc.loadBalancerHosts, 0, i).concat([].slice.call(doc.loadBalancerHosts, i + 1));
                    }
                }
            }
            var send = function () {
                res.json(204);
            };
            logger.debug("CAG", "need to update", needToUpdate);
            if (!needToUpdate) {
                return send();
            } else {

                db.applications.update({appId: req.params.appId}, {$set: {loadBalancerHosts: doc.loadBalancerHosts}}, function () {
                    logger.debug("CAG", "new backends server", doc.loadBalancerHosts);
                    updateLoadBalancer(req.params.appId, send);
                })
            }

        });
    });

    server.listen(config.listenPort || 1337, function () {
        logger.info("CAG", "CAG API server started at port :", server.address().port);
        db.hosts.find({}, function (err, hosts) {
            logger.debug('CAG', 'Letting know vipers that CAG is on board too');
            hosts.forEach(function (host) {
                logger.debug('CAG', 'Contacting viper', host.host, host.port);
                restler.get('http://' + host.host + ':' + host.port + '/cag');
            })
        });
    });
}