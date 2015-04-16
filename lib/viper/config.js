var events = require('events'),
    path = require('path'),
    Datastore = require('nedb'),
    db = new Datastore(path.join(process.cwd(), 'apps.db'));

function Config() {
    if (!(this instanceof Config)) {
        return new Config();
    }

    db.loadDatabase(function (err) {
        if (err) {
            return this.emit('error', err);
        }

        this.emit('loaded', db);
    }.bind(this));

}
Config.prototype = new events.EventEmitter();

module.exports = Config;