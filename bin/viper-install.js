require('../lib/install')(process.argv, {name: 'viper', description: 'Viper Process Manager'}, function (err) {
    process.exit(err ? 1 : 0);
});