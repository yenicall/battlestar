require('../lib/viper').main(process.argv, function(er) {
    if (!er) {
        process.exit(0);
    }
    process.exit(1);
});