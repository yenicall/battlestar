var async = require('async');
var child_process = require('child_process');
var chownr = require('chownr');
var debug = require('debug')('battlestar:install');
var fs = require('fs');
var mkdirp = require('mkdirp');
var Parser = require('posix-getopt').BasicParser;
var passwd = require('passwd-user');
var path = require('path');
var serviceInstall = require('strong-service-install');
var uidNumber = require('uid-number');

module.exports = install;

function printHelp($0, prn) {
    var usageFile = require.resolve('../bin/' + $0.replace('js', 'txt'));
    var USAGE = fs.readFileSync(usageFile, 'utf-8')
        .replace(/%MAIN%/g, $0)
        .trim();
    prn(USAGE);
}

function install(argv, opts, callback) {
    var $0 = process.env.CMD || path.basename(argv[1]);
    var parser = new Parser([
            ':v(version)',
            'h(help)',
            'b:(base)',
            'c:(config)',
            'u:(user)',
            'p:(port)',
            'j:(job-file)',
            'f(force)',
            'i:(upstart)', // -i unused, posix-getopt doesn't do long-only options
            's(systemd)'
        ].join(''),
        argv);

    var ignorePlatform = process.env.SL_PM_INSTALL_IGNORE_PLATFORM;

    var jobConfig = {
        user: opts.name,
        baseDir: null, // defaults to options.cwd in fillInHome
        port: 8701,
        jobFile: null, // strong-service-install provides an init-specific default
        force: false,
        upstart: false,
        systemd: false,
        env: {},
        pmEnv: '',
        pmSeedEnv: {},
        name: opts.name,
        description: opts.description,
        _touched: [] // not a real config, used for recording paths to chown
    };

    var option;
    while ((option = parser.getopt()) !== undefined) {
        switch (option.option) {
            case 'v':
                console.log(require('../package.json').version);
                return callback();
            case 'h':
                printHelp($0, console.log);
                return callback();
            case 'b':
                jobConfig.baseDir = option.optarg;
                break;
            case 'p':
                jobConfig.port = option.optarg | 0; // cast to an integer
                break;
            case 'u':
                jobConfig.user = option.optarg;
                break;
            case 'j':
                jobConfig.jobFile = option.optarg;
                break;
            case 'n':
                jobConfig.dryRun = true;
                break;
            case 'f':
                jobConfig.force = true;
                break;
            case 'i': // actually --upstart
                jobConfig.upstart = option.optarg;
                break;
            case 's':
                jobConfig.systemd = true;
                break;
            default:
                console.error('Invalid usage (near option \'%s\'), try `%s --help`.',
                    option.optopt, $0);
                return callback(Error('usage'));
        }
    }

    if (parser.optind() !== argv.length) {
        console.error('Invalid usage (extra arguments), try `%s --help`.', $0);
        return callback(Error('usage'));
    }

    if (jobConfig.port < 1) {
        console.error('Valid port was not specified, try `%s --help`.', $0);
        return callback(Error('usage'));
    }

    if (process.platform !== 'linux') {
        console.error('%s: only Upstart on Linux is supported',
            ignorePlatform ? 'Warning' : 'Error');
        if (!ignorePlatform)
            return callback(Error('platform'));
    }

    if (!jobConfig.systemd && !jobConfig.upstart) {
        jobConfig.upstart = '1.4'; // default
    } else if (jobConfig.systemd && jobConfig.upstart) {
        console.error(
            'Invalid usage (cannot specify both --systemd and --upstart)' +
            ', see `%s --help`', $0);
        return callback(Error('usage'));
    }
    if (!jobConfig.systemd &&
        jobConfig.upstart !== '0.6' && jobConfig.upstart !== '1.4') {
        console.error('Invalid usage (only upstart "0.6" and "1.4" supported)' +
        ', see `%s --help`', $0);
        return callback(Error('usage'));
    }

    if (jobConfig.env.STRONGLOOP_PM_HTTP_AUTH &&
        auth.parse(jobConfig.env.STRONGLOOP_PM_HTTP_AUTH).scheme === 'none') {
        console.error(
            'Bad http-auth specification: %s', jobConfig.env.STRONGLOOP_PM_AUTH);
        return callback(Error('usage'));
    }

    var steps = [
        ensureUser, fillInGroup, fillInHome,
        resolveIds,
        setCommand, ensureBaseDir,
        ensureOwner, serviceInstall
    ].map(w);

    return async.applyEachSeries(steps, jobConfig, report);

    function report(err) {
        if (err) {
            console.error('Error installing service \'%s\':',
                jobConfig.name, err.message);
        }
        return callback(err);
    }

    function w(fn) {
        return function (opts, cb) {
            debug('enter', fn.name);
            fn(opts, function (err) {
                debug('exit', fn.name, err);
                cb.apply(this, arguments);
            });
        };
    }
}

function ensureUser(options, callback) {
    userExists(options.user, function (err, exists) {
        if (err || exists)
            return callback(err);
        if (process.platform !== 'linux') {
            console.log('skipping user creation on non-Linux platform');
            return callback();
        }
        options.home = '/var/lib/' + options.user;
        useradd(options.user, options.home, callback);
    });
}

function useradd(name, home, callback) {
    var cmd = '/usr/sbin/useradd';
    var args = [
        '--home', home,
        '--shell', '/bin/false',
        '--skel', '/dev/null',
        '--create-home', '--user-group', '--system',
        name
    ];
    child_process.execFile(cmd, args, function (err, stdout, stderr) {
        if (err) {
            console.error('Error adding user %s:\n%s\n%s',
                name, stdout, stderr);
        }
        callback(err);
    });
}

function userExists(name, callback) {
    var cmd = '/usr/bin/id';
    var args = [name];
    child_process.execFile(cmd, args, function (err) {
        callback(null, !err);
    });
}

function fillInGroup(options, callback) {
    var cmd = '/usr/bin/id';
    var args = ['-gn', options.user];
    child_process.execFile(cmd, args, function (err, stdout) {
        if (err) {
            console.error('Could not determine group for service user \'%s\': %s',
                options.user, err.message);
        } else {
            options.group = stdout.trim();
        }
        callback(err);
    });
}

function fillInHome(options, callback) {
    return passwd(options.user, function (err, user) {
        if (err) {
            console.error('Could not determine $HOME of \'%s\':',
                options.user, err.message);
        } else {
            options.env = options.env || {};
            options.env.HOME = user.homedir;
            options.cwd = user.homedir;
            var defaultBaseDir = options.cwd;
            var oldDefaultBaseDir = path.resolve(options.cwd, '.strong-pm');
            // honour old .strong-pm default for existing installs that used it
            if (fs.existsSync(oldDefaultBaseDir)) {
                defaultBaseDir = oldDefaultBaseDir;
            }
            options.baseDir = options.baseDir || defaultBaseDir;
        }
        callback(err);
    });
}

function resolveIds(options, callback) {
    uidNumber(options.user, options.group, function (err, uid, gid) {
        if (err) {
            console.error('Error getting numeric uid/gid of %s/%s: %s',
                options.user, options.group, err.message);
            return callback(err);
        }
        options._userId = uid;
        options._groupId = gid;
        callback();
    });
}

function setCommand(options, callback) {
    options.baseDir = path.resolve(options.cwd, options.baseDir);
    options.command = [
        process.execPath,
        require.resolve('../bin/' + options.name),
        '--listen', options.port
    ];
    // always async
    return setImmediate(callback);
}

function ensureBaseDir(options, callback) {
    if (options.dryRun) {
        console.log('would create', options.baseDir);
        return setImmediate(callback);
    }
    mkdirp(options.baseDir, {}, function (err, made) {
        if (err) {
            console.error('Error creating base directory %s: %s', made, err.message);
        }
        if (made) {
            options._touched.push(made);
        }
        callback(err);
    });
}

function ensureOwner(options, callback) {
    debug('ensuring owner: ', [options.baseDir].concat(options._touched));
    var tasks = [
        // non-recusive for basedir since it may be an existing $HOME
        fs.chown.bind(fs, options.baseDir, options._userId, options._groupId)
    ].concat(options._touched.map(function (path) {
            // recursive for everything else because we can
            return chownr.bind(null, path, options._userId, options._groupId);
        }));

    return async.parallel(tasks, callback);
}
