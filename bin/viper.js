/*require('../lib/viper').main(process.argv, function(er) {
    if (!er) {
        process.exit(0);
    }
    process.exit(1);
});*/

var config = require('../config.json');
var WorkersManager = require('../lib/workersManager');
var cluster = require('cluster');
if(cluster.isMaster) {
    for (var appId in config) {
        var w = new WorkersManager(appId, config[appId]);
        w.spawnWorkers(2);
    }
}