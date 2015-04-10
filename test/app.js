var a = require('./print');
a.p();
require('./test');
var http = require('http'),
    server = http.createServer(),
    port = process.env.PORT || 0;
server.listen(port, function () {
    console.log(process.cwd());
});