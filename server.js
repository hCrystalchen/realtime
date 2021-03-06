var http = require('http');
var express = require('express');
var app = express();
var server = http.createServer(app);
var io = require('socket.io').listen(server);
// var bodyParser = require('body-parser');
var anyDB = require('any-db');
var colors = require('colors');
var engines = require('consolidate');

app.engine('html', engines.hogan);
app.set('views', __dirname + '/templates');
app.set('view engine', 'html');

// setup static resources (css, js, images)
app.use(express.static(__dirname + '/public'));

// set up database
var conn = anyDB.createConnection('sqlite3://chatroom.db');
// create message table
var messageQuery = 'CREATE TABLE IF NOT EXISTS message (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, conversation STRING, socketid TEXT, body TEXT, time INTEGER, nickname TEXT)';
conn.query(messageQuery, function(error, data) {
    if (error != null)
        console.error("message: " + error);
});
// create room table
var roomQuery = 'CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)';
conn.query(roomQuery, function(error, data) {
    if (error != null)
        console.error("room: " + error);
});
// create user table
var userQuery = 'CREATE TABLE IF NOT EXISTS user (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT, socketid TEXT, nickname TEXT, status TEXT)';
conn.query(userQuery, function(error, data) {
    if (error != null)
        console.error("user: " + error);
});

// set of existing identifiers for quick check of whether an identifier already exists
var existingRooms = new Set();

// clear and close database and end process on SIGINT
process.on('SIGINT', function() {
    closeProgram();
});

// path to retrieve a unique identifier to identify a new chatroom
app.get('/chatroom', function(request, response) {
    console.log('Request received:', request.method.cyan, request.url.underline);
    // generate identifier
    var identifier = generateRoomIdentifier();
    response.json({room: identifier});
});

app.get('/favicon.ico', function(request, response) {
    console.log('Ignore favicon request');
});

// a specific chatroom identified by roomName
app.get('/:roomName', function(request, response) {
    console.log('Request received:', request.method.cyan, request.url.underline);
    // inserting room identifier into database here instead of when the identifier is generated
    // handles the case where an user enters a room whose roomName is not generated by the homepage link
    recordRoom(request.params.roomName);
    response.render('room.html', {roomName: request.params.roomName});
});

// home page
app.get('/', function(request, response) {
    console.log('Request received:', request.method.cyan, request.url.underline);
    response.sendFile(__dirname + "/home.html");
});

// 404 page for everything else
app.get('*', function(request, response) {
    console.log('- Request received:', request.method.cyan, request.url.underline);
    response.status(404).type('html');
    response.write('<h1> Error: 404 </h1>');
    response.end();
});

io.sockets.on('connection', function(socket) {
    // clients emit this when they join new rooms
    socket.on('join', function(roomName, conversation, nickname, callback) {
        socket.join(roomName, function(err) {
            if(err != null) console.error("join: " + err);
        }); // socket.io method
        socket.nickname = nickname; //javascript magic
        socket.roomName = roomName;
        onJoin(socket, roomName, conversation, nickname, callback);
    });

    // clients emit this when a user changes his/her nickname
    socket.on('nickname', function(conversation, nickname) {
        onRename(socket, conversation, nickname);
    });

    // clients emit this when the they are either in a group chat or private chat with the user that changed
    // his/her nickname and thus needs to refresh the chat history to reflect this change
    socket.on('update', function(conversation) {
        onUpdate(socket, conversation);
    });

    // clients emit this when they want a list of previously active rooms
    socket.on('rooms', function(room, callback) {
        getRooms(room, callback);
    });

    // client emit this when they want to send a message
    socket.on('message', function(conversation, message) {
        onNewMessage(socket, conversation, message);
    });

    // client emit this when their status changes
    socket.on('status', function(status) {
        onStatusChanged(socket, status);
    });

    // client emit this when changing conversation (group vs. private)
    socket.on('conversation', function(conversation, callback) {
        getMessages(socket, conversation, callback, false);
    });

    // client emit this when their typing status changes
    socket.on('typing', function(conversation, id, isTyping) {
        onTyping(socket, conversation, id, isTyping);
    });

    // clients disconnected/closed their browser window
    socket.on('disconnect', function() {
        onDisconnect(socket);
    });

    socket.on('error', function() {
        console.log("ERROR on: " + socket + "with name: " + socket.nickname + "in" + socket.roomName);
        // notify users in the same room
        io.sockets.in(socket.roomName).emit('onerror', socket.nickname, 'An error has occured.', Date());
    });
});

/*
 * Determines how a new message is handled and emitted to clients (private vs. public)
 */
function onNewMessage(socket, conversation, message) {
    var rooms = conversation.split(",");
    var name = socket.nickname;
    var time = Date();
    // make sure the socket sending the message request is actually in the private convo they claim to be in according to
    // the conversation id so that no user can send message to the private convos of other users
    if (parseInt(rooms[0]) === socket.tableID || parseInt(rooms[1]) === socket.tableID) {
        processMessage(socket.roomName, conversation, socket.id, time, message, name, true);
    } else if (conversation == 0) {
        // if the client is in the main conversation, private === false
        processMessage(socket.roomName, conversation, socket.id, time, message, name, false);
    }
}
/*
 * Insert new user into user table, fetch and display message history, and notify all users in the same room of new user
 */
function onJoin(socket, roomName, conversation, nickname, callback) {

    var sql = 'INSERT INTO user VALUES($1, $2, $3, $4, $5)';
    // every user is active when he/she first joins the chat, users are identified by their socket id in the database
    // so different users can have the same name and would still be considered separate users
    conn.query(sql, [null, roomName, socket.id, nickname, "ACTIVE"], function(error,data) {
        if(error != null) console.error("onJoin: insert: " + error);
        getMessagesAndUsers(roomName, callback, false); // get list of messages currently in the room and send it back
        sql = 'SELECT nickname, status, id FROM user WHERE socketid=$1';
        conn.query(sql, [socket.id], function(error, data) {
            if(error != null) console.error("onJoin: select: " + error);
            if(data.rows.length > 0) {
                io.sockets.in(roomName).emit('joining', data.rows[0]);
                // save table id to socket
                socket.tableID = data.rows[0].id;
            }
        });
    });
}

/*
 * Update status of user in the user table and notify all users in the same chatroom of the change
 */
function onStatusChanged(socket, status) {
    var sql = 'UPDATE user SET status=$1 WHERE socketid=$2';
    var sql2 = 'SELECT nickname, status, id FROM user WHERE room=$1'
    conn.query(sql, [status, socket.id], function(error, data) {
        if (error != null) console.error("onStatusChanged: update: " + error);
        conn.query(sql2, [socket.roomName], function(error, users) {
            if (error != null) console.error("onStatusChanged: select: " + error);
            io.sockets.in(socket.roomName).emit('status', users.rows);
        });
    });
}

/*
 * Update user table and notify rest of users in the same room of the current user leaving the room
 */
function onDisconnect(socket) {
    io.sockets.in(socket.roomName).emit('leaving', socket.tableID);
    var sql = 'DELETE FROM user WHERE socketid=$1';
    conn.query(sql, [socket.id],function(error, data) {
        if (error != null) console.error("onDisconnect: delete: " + error);
    });
}

/*
 * Notify all users in the same room if the client is typing in the main group chat. Otherwise, find the user that the client
 * is in a private convo with and notify only that person of the typing status change
 */
function onTyping(socket, conversation, id, isTyping) {
    if (conversation == 0) {
        // all users except for the one whose typing status changed
        socket.broadcast.to(socket.roomName).emit('typing', conversation, socket.nickname, isTyping);
    } else {
        var rooms = conversation.split(",");
        var target = parseInt(rooms[0]);
        if (target == id) {
            target = parseInt(rooms[1]);
        }
        var sql = 'SELECT socketid FROM user WHERE id=$1';
        conn.query(sql, [target], function(error, data) {
            if (data.rows.length > 0){
                var user = data.rows[0].socketid;
                // only the user the client is talking to privately
                io.to(user).emit('typing', conversation, socket.nickname, isTyping);
            }
        });
    }
}

/*
 * Update message and user tables and notify all users in the room of the name change
 */
function onRename(socket, conversation, nickname) {
    // change nickname of socket (user)
    socket.nickname = nickname;
    var sql = 'UPDATE message SET nickname=$1 WHERE socketid=$2';
    // update nickname of a socket in the database
    conn.query(sql, [nickname, socket.id], function(error, data) {
        if (error != null)
            console.error("onRename: update: message: " + error);
    });

    // update nickname of a socket
    var sql2 = 'UPDATE user SET nickname=$1 WHERE socketid=$2';
    conn.query(sql2, [nickname, socket.id],function(error, data) {
        if (error != null)
            console.error("onRename: update: user: " + error);
    });
    getUsers(socket.roomName, function(users) {
        var id = socket.tableID;
        // broadcast rename to all other users in the same room!
        io.sockets.in(socket.roomName).emit('rename', id, users);
    });
}

/*
 * Send appropriate list of messages to the client that requested it (to make sure that private convos are PRIVATE)
 */
function onUpdate(socket, conversation) {
    getMessages(socket, conversation, function(messages, animate) {
        // only to the client that has emitted the update request
        io.to(socket.id).emit('update', conversation, messages, animate);
    }, false)
}

/*
 * Clear the message, room, and user tables and close the database before exiting the
 * process
 */
function closeProgram() {
    conn.query('DELETE FROM message', function(error, data) {
        if (error != null)
            console.error("closeProgram: message: " + error)
        else
            console.log("message data deleted");
    });
    conn.query('DELETE FROM room', function(error, data) {
        if (error != null)
            console.error("closeProgram: room: " + error)
        else
            console.log("room data deleted");
    });
    conn.query('DELETE FROM user', function(error, data) {
        if (error != null)
            console.error("closeProgram: user: " + error)
        else
            console.log("user data deleted");
    });
    conn.end(function() {
        console.log('Process and connection closing...');
        process.exit(0);
    });
}

/*
 * Get and send all rooms except for the room passed in (current room) to all users in the room
 */
function getRooms(room, callback) {
    var sql = 'SELECT * FROM room WHERE NOT name=$1';
    var con = conn.query(sql, [room], function(error, data){
        if (error != null) console.error("getRooms: " + error);
        var rooms = data.rows;
        callback(rooms);
    });
}

/*
 * Get and pass in messages in the same room & convo as well as a list of users in the current room to callback
 */
function getMessagesAndUsers(roomName, callback, animate) {
    var sql = 'SELECT nickname, time, body FROM message WHERE room=$1 AND conversation=$2 ORDER BY time ASC';
    var q = conn.query(sql, [roomName, "0"], function(error, data) {
        if (error != null) console.error("getMessagesAndUsers: message: " + error);
        sql = 'SELECT nickname, status, id FROM user WHERE room=$1';
        var results = data.rows;
        conn.query(sql, [roomName], function(error,data) {
            if (error != null) console.error("getMessagesAndUsers: user: " + error);
            var users = data.rows;
            callback(results, users, animate);
        });
    });
}

/*
 * Get and pass in any messages in the database that belongs to the current room and convo to callback
 */
function getMessages(socket, conversation, callback, animate) {
    var rooms = conversation.split(",");
    // check if the socket sending the request is one of the users involved in the convo to make sure clients can't
    // access message history of private convos they are not involved in
    if (conversation == 0 || rooms[0] === "" + socket.tableID || rooms[1] === "" + socket.tableID){
        var sql = 'SELECT nickname, time, body FROM message WHERE room=$1 AND conversation=$2 ORDER BY time ASC';
        var q = conn.query(sql, [socket.roomName, conversation], function(error, data) {
            if (error != null) console.error("getMessages: " + error);
            var results = data.rows;
            callback(results, animate);
        });
    }
}

/*
 * Get and pass in any users in the database that belongs to the current room to callback
 */
function getUsers(roomName, callback) {
    var sql = 'SELECT nickname, status, id FROM user WHERE room=$1';
    conn.query(sql, [roomName], function(error,data) {
        if (error != null) console.error("getUsers: " + error);
        var users = data.rows;
        callback(users);
    });
}

/*
 * Insert message into database and send to all users in the room
 */
function processMessage(room, conversation, id, time, message, nickname, private) {
    var sql = 'INSERT INTO message VALUES($1, $2, $3, $4, $5, $6, $7)';
    conn.query(sql, [null, room, conversation, id, message, time, nickname], function(error, data) {
        if (error != null) console.error("processMessage: " + error);
    });
    var rooms = conversation.split(",");
    // if private, send only to the two users involved in the private convo
    if (private) {
        var sql2 = 'SELECT socketid FROM user WHERE id=$1 OR id=$2';
        conn.query(sql2, [parseInt(rooms[0]), parseInt(rooms[1])], function(error, data) {
            if(error != null) console.error("processMessage: find socket:" + error);
            var clients = data.rows;
            if (clients.length > 0){
                // user one
                io.to(clients[0].socketid).emit('message', conversation, nickname, message, time);
            }
            if(clients.length > 1){
                // user two
                io.to(clients[1].socketid).emit('message', conversation, nickname, message, time);
            }
        });
    } else {
        // emit to all users in the same room
        io.sockets.in(room).emit('message', conversation, nickname, message, time);
    }
}

/*
 * Insert room identifier into the room table if the room has not been visited before
 */
function recordRoom(name) {
    checkIfRoomExists(name, function() {
        conn.query("INSERT INTO room VALUES($1, $2)", [null, name], function(error, data) {
            if (error != null) console.error("recordRoom: " + error);
        });
        existingRooms.add(name);
    });
}

/*
 * Check if a room has been entered before, if not, execute callback
 */
function checkIfRoomExists(room, callback) {
    var con = conn.query('SELECT * FROM room', function(error, data){
        if (error != null) console.error("checkIfRoomExists: " + error);
        var rows = data.rows;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].name === room) {
                return true;
            }
        }
        callback();
    });
}

/*
 * Generate a random 6-character alphanumeric identifier to uniquely identify a chatroom
 */
function generateRoomIdentifier() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var result = '';
    for (var i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random()*chars.length));
    }
    // if the first id generated already exists, generate new id until a unique one is found
    while (existingRooms.has(result)) {
        for (var i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random()*chars.length));
        }
    }
    return result;
}

server.listen(8080);
