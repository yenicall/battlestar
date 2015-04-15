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
    db = {
        applications: new Datastore(path.join(process.cwd(), 'applications.db')),
        hosts: new Datastore(path.join(process.cwd(), 'hosts.db'))
    };

logger.level = (config.logLevel || 'DEBUG').toUpperCase();

try {
    config = require(path.join(process.cwd(), 'config.json'));
} catch (e) {

}
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
            redis.del('frontend:' + doc.hostname, function (err) {
                redis.rpush('frontend:' + doc.hostname, function (err) {
                    //If use all available hosts
                    async.each(doc.loadBalancerHosts, function (host, cb) {
                        redis.rpush('frontend:' + doc.hostname, 'http://' + host.host + ':' + host.port, cb);
                    }, function (err) {
                        callback();
                    });
                });
            });
        });
    }

    function deployApp(appId, hosts) {
        db.applications.findOne({appId: appId}, function (err, doc) {
            var zipPath = path.join(process.cwd(), 'apps', doc.appId),
                zip = path.join(zipPath, doc.version + ".zip");
            fs.exists(zip, function (exists) {
                if (exists) {
                    logger.info('CAG', "Deploying", doc.appId, "version", doc.version);

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
                        fs.stats(zip, function (err, stats) {
                            var file = restler.file(zip, null, stats.size, null, 'application/zip');
                            async.each(uploadHosts, function (url, cb) {
                                restler.post(url + "/apps/" + appId, {
                                    multipart: true,
                                    data: {
                                        version: doc.version,
                                        app: doc.apps[doc.version - 1],
                                        env: doc.envs[doc.version - 1],
                                        zip: file
                                    }
                                }).on('error', function (e) {
                                    logger.error(e);
                                })
                                    .on('complete', function (e) {
                                        logger.error(e);
                                        logger.debug("CAG", "Application deployed on", url);
                                        cb();
                                    })
                            }, function () {
                                logger.debug("CAG", "Application deployed on all hosts");
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
            if (err) {
                return next(new restify.InvalidArgumentError('appId already exists'));
            }
            try {
                fs.mkdirSync(path.join(process.cwd(), 'apps', req.body.appId));
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
                var _len = req.body.hosts.length;
                for (var i = 0; i < _len; i++) {
                    (function (host, i) {
                        dns.lookup(host, function (err, ip) {
                            if (!err) {
                                newDoc.hosts.push({
                                    host: ip,
                                    port: 0
                                });
                            }
                            if (i === _len - 1) {
                                insert();
                            }
                        });

                    })(req.body.hosts[i], i);
                }
            } else {
                insert();
            }


        });
    });

    server.put('/apps/:appId', function (req, res, next) {
        if (!req.body && !req.files) {
            return next(new restify.MissingParameterError('missing body or file'));
        }
        if (!req.body.app) {
            return next(new restify.MissingParameterError('app'));
        }
        db.applications.findOne({appId: req.params.appId}, function (err, doc) {
            if (err || !doc) {
                return next(new restify.InvalidArgumentError('appId not exists'));
            }
            doc.version = doc.env.length + 1;
            var zipPath = path.join(process.cwd(), 'apps', doc.appId);
            var updateQuery = {$inc: {version: 1}, $set: {}};
            updateQuery['$set']['apps.' + doc.version] = req.body.app;

            function send() {
                res.json(201);
            }

            //Update hosts
            function updateHosts() {
                if (!req.body || !req.body.hostame) {
                    return updateHostname();
                }

                if (!req.body.hosts) {
                    updateQuery['$unset'] = {hosts: true};
                    updateHostname();
                } else {
                    if (Array.isArray(req.body.hosts)) {
                        var hosts = [],
                            updateHostsQuery = function () {
                                updateQuery.$set.hosts = hosts;
                                updateHostname();
                            };
                        var _len = req.body.hosts.length;
                        for (var i = 0; i < _len; i++) {
                            (function (host, i) {
                                dns.lookup(host, function (err, ip) {
                                    if (!err) {
                                        hosts.push({
                                            host: ip,
                                            port: 0
                                        });
                                    }
                                    if (i === _len - 1) {
                                        updateHostsQuery();
                                    }
                                });
                            })(req.body.hosts[i], i);
                        }
                    } else {
                        updateHostname();
                    }
                }

            }

            function updateHostname() {
                if (req.body && req.body.hostname) {

                    updateQuery.$set.hostname = req.body.hostname;
                }
                updateZip();
            }

            function updateZip() {
                if (!updateQuery.$push) {
                    updateQuery.$push = {};
                }
                if (!req.files || !req.files.zip) {
                    if (doc.apps && doc.apps.length) {
                        updateQuery.$push.apps = doc.apps[doc.apps.length - 1];
                    } else {
                        updateQuery.$push.apps = "";
                    }
                    return updateEnv();
                }
                var is = fs.createReadStream(req.files.zip.path),
                    os = fs.createWriteStream(path.join(zipPath, (doc.version) + ".zip"));

                is.pipe(os);
                is.on('end', function () {
                    fs.unlink(req.files.zip.path, function () {
                        updateEnv();
                    });
                });
            }

            function updateEnv() {
                if (!updateQuery.$push) {
                    updateQuery.$push = {};
                }
                if (!req.body.env) {
                    if (doc.envs && doc.envs.length) {
                        updateQuery.$push.envs = doc.envs[doc.envs - 1];
                    } else {
                        updateQuery.$push.envs = {};
                    }
                    return update();
                }
                updateQuery.$push.envs = req.body.env;

                //Do we have a current zip ?
                fs.exists(path.join(zipPath, (doc.version) + ".zip"), function (found) {
                    //Yes then update
                    if (found) {
                        return update();
                    }
                    fs.exists(path.join(zipPath, (doc.version - 1) + ".zip"), function (found) {
                        //No -1
                        if (!found) {
                            return update();
                        }

                        var oldVersion = fs.createReadStream(path.join(zipPath, (doc.version - 1) + ".zip"));
                        oldVersion.on("error", next);
                        var newVersion = fs.createWriteStream(path.join(zipPath, (doc.version) + ".zip"));
                        newVersion.on("error", next);
                        newVersion.on("close", update);
                        oldVersion.pipe(newVersion);

                    });
                });
            }

            function update() {
                //If no update need then do nothing
                db.applications.update({appId: req.params.appId}, updateQuery, function (err) {
                    deployApp(req.params.appId);
                    send();
                })
            }


            updateHosts();
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
            if (!needToUpdate) {
                return send();
            } else {
                db.applications.update({appId: req.params.appId}, {$set: {loadBalancerHosts: doc.loadBalancerHosts}}, function () {
                    updateLoadBalancer(req.params.appId, send);
                })
            }

        });
    });

    server.listen(config.listenPort || 1337, function () {
        logger.info("CAG", "CAG API server started at port :", server.address().port);
    });
}