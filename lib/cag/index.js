var config = require(path.join(process.cwd(), 'config.json')),
    logger = require('../logger'),
    restify = require('restify'),
    Datastore = require('nedb'),
    Redis = require('redis'),
    db = {
        applications: new Datastore(path.join(process.cwd(), 'applications.db')),
        hosts: new Datastore(path.join(process.cwd(), 'applications.db'))
    };

logger.level = (config.logLevel || 'DEBUG').toUpperCase();
logger.addTransport('CAG', function () {
    var args = [].slice.call(arguments, 0),
        section = args.shift(),
        level = args.shift(),
        log = args.join("\n");
    client.post('/logs', {section: section, level: level, logs: log}, function () {
    });
}, false);
db.applications.loadDatabase(function () {
    db.hosts.loadDatabase(function () {
        main();
    })
});
function main() {
    var redis = Redis.createClient();
    var server = restify.createServer({
        name: 'CAG'
    });

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.queryParser());
    server.use(restify.bodyParser({mapParams: false}));

    server.post('/logs', function (req, res) {
        logger[req.body.level.toLowerCase()](req.body.section, req.body.logs);
    });

    server.post('/viper', function (req, res) {
        db.hosts.findOne({host: req.body.ip}, function (err, doc) {
            var send = function () {
                res.json(201);
            };
            if (err || !doc) {
                return db.insert({
                    host: req.body.ip,
                    port: req.body.port
                }, send)
            }
            //Update port if different
            if (doc.port !== parseInt(req.body.port)) {
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
            db.applications.insert({
                appId: req.body.appId,
                hostname: req.body.hostname
            })
        });
    });

    server.post('/apps/:appId', function (req, res, next) {
        if (!req.body || !req.body.port) {
            return next(new restify.MissingParameterError('port'));
        }
        db.applications.findOne({appId: req.params.appId}, function (err, doc) {
            if (err || !doc) {
                return next(new restify.InvalidArgumentError('appId not exists'));
            }
            if (!doc.hosts || !doc.hosts.length) {
                doc.hosts = [{
                    ip: req.body.ip,
                    port: req.body.port
                }];
            } else {
                var found = false, i = 0, _len = doc.hosts.length;
                while (!found || i < _len)
                    }
                redis.delete('front:' + doc.hostname, function () {
                    redis.rpush('front:' + req.body.hostname, req.body.appId, function () {
                        //db.host
                    });
                });
            }
            )
        });

        server.post('/apps/:appId/path', function (req, res, next) {
            applicationManager.setPath(req.params.appId, req.body.path, function (err) {
                if (err) {
                    return next(new restify.InvalidArgumentError('Unkown appId'));
                }
                res.json(204);
            });
        });

        server.post('/apps/:appId/env', function (req, res, next) {

            applicationManager.setEnv(req.params.appId, req.body.env, function (err) {
                if (err) {
                    return next(new restify.InvalidArgumentError('Unkown appId'));
                }
                res.json(204);
            });

        });
        server.put('/apps/:appId', function (req, res, next) {
            if (req.params.appId === "all") {
                return applicationManager.run(function () {
                    res.json(204);
                });
            }
            applicationManager.run(req.params.appId, function (err) {
                if (err) {
                    return next(new restify.InvalidArgumentError('Unkown appId or invalid path'));
                }

                res.json(204);
            })
        });
        server.listen(config.listenPort || 1337, function () {
            logger.info("CAG", "CAG API server started at port :", server.address().port);
        });
    }