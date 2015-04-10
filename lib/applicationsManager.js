var events = require('events'),
    config = require('./config')(),
    WorkersManager = require('./workersManager');
function ApplicationManager() {
    this._db = null;
    this._applications = {};
    config.once('loaded', function (db) {
        db.ensureIndex({fieldName: 'appId', unique: true});
        this._db = db;
        this._db.find({}, function (err, docs) {
            if (!err && docs) {
                docs.forEach(function (doc) {
                    this._applications[doc.appId] = doc;
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

ApplicationManager.prototype.addApplication = function (doc) {
    this._isLoaded(function () {
        this._db.insert(doc, function (err, doc) {
            if (!err) {
                this._applications[doc.appId] = doc;
                this.emit('applicationAdded', doc);
            }
        }.bind(this));
    });
};

ApplicationManager.prototype.listApplications = function (callback) {
    this._isLoaded(function () {
        callback(this._applications);
    });
};

module.exports = ApplicationManager;