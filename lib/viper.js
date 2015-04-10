var ApplicationManager = require('./applicationsManager'),
    applicationManager = new ApplicationManager();
function main(argv, callback) {

    applicationManager.addApplication({appId: argv[2], path: argv[3]});
    applicationManager.on('applicationAdded', function (doc) {
        console.log(doc);
        applicationManager.listApplications(function(app){
            console.log(app);
        });
    });


}
exports.main = main;