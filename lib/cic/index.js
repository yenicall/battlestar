var restler = require('restler'),
    util = require('util'),
    colors = require('colors'),
    fs = require('fs'),
    tar = require('tar-fs'),
    path = require('path'),
    tmpDir = require('os').tmpdir(),
    fse = require('fs-extra'),
    config = {
        cag: 'http://localhost:1337'
    };

function postJson(path, values, callback) {
    restler.postJson(config.cag + path, values).on('complete', callback);
}

function putJson(path, values, callback) {
    restler.putJson(config.cag + path, values).on('complete', callback);
}

function putFile(path, filePath, callback) {
    fs.stat(filePath, function (err, stats) {
        var file = restler.file(filePath, null, stats.size, null, 'application/tar');
        var values = {
            multipart: true,
            data: {
                package: file
            }
        };
        restler.put(config.cag + path, values).on('complete', callback);
    })

}

function error() {
    var args = [].slice.call(arguments, 0);
    console.error("CIC :".green, colors.red(util.format.apply(null, args)));
    process.exit(1);
}

function success() {
    var args = [].slice.call(arguments, 0);
    console.log("CIC :".green, colors.yellow(util.format.apply(null, args)));
    process.exit(0);
}

var cli = {
    help: function () {
        console.log('Help');
        process.exit(0);
    },
    create: function (appId, hostname) {
        if (!appId || !hostname) {
            this.help('create');
        }
        putJson('/apps', {
            appId: appId,
            hostname: hostname
        }, function (data, response) {
            if (response.statusCode >= 400) {
                switch (data.code) {
                    case 'MissingParameter':
                        error("%s is not defined", data.message);
                        break;
                    case 'InvalidArgument':
                        error("%s already exists", appId);
                        break;
                }
            }
            success("Application created");
        })
    },
    env: function () {
        var args = [].slice.call(arguments, 0);
        if (!args.length) {
            this.help('env', "No application passed");
        }
        if (args.length === 1) {
            this.help('env', "No mode passed.", "Use set or del");
        }
        if ((args[1] !== "set" && args[1] !== "del")) {
            this.help('env', 'Wrong mode used', "Use set or del");
        }
        if (args.length === 2) {
            this.help('env', "No envs passed");
        }
        var appId = args.shift(),
            mode = args.shift(),
            envs = mode === "set" ? {} : [];

        while (args.length) {
            var env = args.shift(),
                parts = env.split('='),
                envName = parts.shift(),
                envValue = parts.join('=');
            switch (mode) {
                case "set":
                    if (env.indexOf('=') === -1) {
                        this.help('env', "%s need a value in set mode", env);
                    }
                    envs[envName] = envValue;
                    break;
                case "del":
                    if (env.indexOf('=') !== -1) {
                        this.help('env', "%s can not be assigned in del mode", envName);
                    }
                    envs.push(env);
            }

        }
        putJson('/apps/' + appId, {envs: {mode: mode, data: envs}}, function (data, response) {
            if (response.statusCode >= 400) {
                error("Oops something bad happened ", data.message);
            }
            success("Envs ware correctly updated");
        })

    },
    deploy: function (appId) {
        if (!appId) {
            this.help('deploy');
        }
        fs.exists('battlestar.json', function (exist) {
            var tmpPath = path.join(tmpDir, 'cic_' + Math.random().toString(36) + ".tar");

            function callback(err) {
                if (err) {
                    error("Error happened during the packaging");
                }
                putFile('/apps/' + appId, tmpPath, function (data, response) {
                    fse.remove(tmpPath, function () {
                        if (response.statusCode >= 400) {
                            error('Deployment failed :', data.message);
                        }
                        success(appId, "was correctly deployed");
                    });
                })
            }

            if (!exist) {
                error("Can not deploy, battlestar.json missing");
            }

            tar.pack('.', {
                ignore: function (name) {
                    return name.indexOf('.') === 0 || name === "node_modules" || name === "bower_components";
                }
            })
                .pipe(fs.createWriteStream(tmpPath))
                .on('error', callback)
                .on('finish', callback);
        })
    },
    rollback: function (appId, version) {
        version = parseInt(version, 10);
        if (!appId || !version) {
            this.help("rollback");
        }
        postJson('/apps/' + appId + "/rollback", {version: version}, function (data, response) {
            if (response.statusCode >= 400) {
                console.log(data);
                switch (data.code) {
                    case 'MissingParameter':
                        error("%s is not defined", data.message);
                        break;
                    case 'InvalidArgument':
                        if (data.message === "appId") {
                            error(appId, " does not exists");
                        }
                        error("Version :", version, "is not a valid version for", appId);
                        break;
                }
            }
            success(appId, 'rolled back to ', version);
        })
    }
};


var args = process.argv.slice(2),
    command = args[0] || 'help';
if (cli[command]) {
    cli[command].apply(cli, args.slice(1))
} else {
    if (command) {
        console.error('unknown command ' + command.red);
        process.exit(1)
    }
}

