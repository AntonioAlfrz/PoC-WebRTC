var express = require('express');
var app = express();
// Serve static files
app.use('/',express.static('public'));
var server = require('http').createServer(app);
var port = process.env.PORT || 8080;
var io = require('socket.io')(server);

io.sockets.on('connection', function (socket) {
    socket.on('create or join', function (room) { // Handle 'create or join' messages
        var numClients = io.sockets.adapter.rooms[room] ? io.sockets.adapter.rooms[room].length : 0;

        console.log('S --> Room ' + room + ' has ' + numClients + ' client(s)');
        console.log('S --> Request to create or join room', room);

        if (numClients == 0) { // First client joining...
            socket.join(room);
            socket.emit('created', room);
        } else if (numClients == 1) { // Second client joining...
            io.sockets.in(room).emit('join', room);
            socket.join(room);
            socket.emit('joined', room);
        } else { // max two clients
            socket.emit('full', room);
        }
    });

    socket.on('message', function (message) { // Handle 'message' messages
        console.log('S --> got message: ', message);
        // socket.broadcast.to(message.channel).emit('message', message);
        socket.broadcast.emit('message', message);
    });

    function log() {
        var array = [">>> "];
        for (var i = 0; i < arguments.length; i++) {
            array.push(arguments[i]);
        }
        socket.emit('log', array);
    }
});
server.listen(port, function () {
    console.log('Server listening at port %d', port);
});