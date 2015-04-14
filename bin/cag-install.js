#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" --expose-gc --always-compact -- "$0" "$@"
require('../lib/install')(process.argv, {name: 'cag', description: 'CAG Process Manager'}, function (err) {
    process.exit(err ? 1 : 0);
});