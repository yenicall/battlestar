require('../lib/install')(process.argv, {name: 'cag', description: 'CAG Process Manager'}, function (err) {
    process.exit(err ? 1 : 0);
});