#!/bin/sh
':' //; exec "$(command -v nodejs || command -v node)" --expose-gc --always-compact -- "$0" "$@"

require('../lib/viper');