var path = require('path'),
    config = require(path.join(process.cwd(), 'config.json')),
    restify = require('restify'),
    ApplicationsManager = require('./applicationsManager'),
    applicationManager = new ApplicationsManager(),
    logger = require('../logger'),
    ip = require('ip'),
    cluster = require('cluster');
var client = restify.createJsonClient({
    url: 'http://' + ((config.cag) ? config.cag : 'localhost:1337'),
    version: '*'
});
if (cluster.isMaster) {

    logger.level = (config.logLevel || 'DEBUG').toUpperCase();
    logger.addTransport('CAG', function () {
        var args = [].slice.call(arguments, 0),
            section = args.shift(),
            level = args.shift(),
            log = args.join(" ");
        client.post('/logs', {section: section, level: level, logs: log}, function () {
        });
    }, false);
    var server = restify.createServer({
        name: 'Viper'
    });

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.queryParser());
    server.use(restify.bodyParser({mapParams: false}));

    server.get('/apps', function (req, res) {
        applicationManager.listApplications(function (apps) {
            res.json({applications: apps});
        })
    });

    server.put('/apps', function (req, res, next) {
        if (!req.body || !req.body.appId) {
            return next(new restify.MissingParameterError('appId'));
        }
        applicationManager.addApplication(req.body, function (err, doc) {
            if (err) {
                return next(new restify.InvalidArgumentError('appId already exists'));
            }
            res.json(201, {appId: doc.appId});
        })
    });

    server.post('/apps/:appId', function (req, res, next) {
        if (!req.body || !req.body.version) {
            return next(new restify.MissingParameterError('version'));
        }
        if (!req.body || !req.body.app) {
            return next(new restify.MissingParameterError('app'));
        }
        applicationManager.deploy(req.params.appId, req.body.version, req.body.app, req.files.zip.path, function (err) {
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
    server.listen(config.listenPort || 4242, function () {
        logger.info("Viper", "Viper API server started at port :", server.address().port);
        var sendToCAG = function () {
            client.post('/vipers', {ip: ip.address(), port: server.address().port}, function (err) {
                if (err) {
                    sendToCAG();
                }
            });
        };
        sendToCAG();
    });
}
applicationManager.run(function () {
});
applicationManager.on('listening', function (result) {
    var sendToCAG = function () {
        client.post('/apps/' + result.appId, {state: 'running', ip: ip.address(), port: result.port}, function (err) {
            if (err) {
                //    sendToCAG();
            }
        });
    };
    sendToCAG();
});