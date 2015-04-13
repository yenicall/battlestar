var a = require('./print');
console.log("app2");
a.p();
require('./test');
var http = require('http'),
    server = http.createServer(),
    port = process.env.PORT || 0;
server.listen(port, function () {
    console.log(process.cwd());
    if(Math.random()>0.6){
        throw new Error("die 2");
    }
});