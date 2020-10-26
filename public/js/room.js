var socket = io.connect();

// idle time counter
var idleTime = 0;
// current status, use string instead of true/false in case want to have more than two statuses
var status = "ACTIVE";
// is the user currently typing
var isTyping = false;
// typing timeout (more than a second between keyup events will change status from typing to nottyping)
var typingTimeout;
// 0 represents the main group conversation
// otherwise, it is the id of the two users in the user table in the private convo separated by a comma (ex: 11,12)
var conversation = "0";
// the id of this socket in the user table (using table id instead of socketid so that everything that deals with socketid
// is done on the server side)
var thisId;
// create object (and use as library) to keep track of notification counts
var notifications = {};
// dictionary for user list items
var users = {};

// when the page is ready
$(document).ready(function() {
  // handle incoming message
  socket.on('message', function(convo, nickname, message, time) {
      newMessage(convo, nickname, message, time);
  });

  // handle members joining
  socket.on('joining', function(member){
      displayUser(member.nickname, member.status, member.id);
  });

  // handle members leaving
  socket.on('leaving', function(id) {
      removeUser(id);
  });

  // handle members renaming
  socket.on('rename', function(id, members) {
      onRename(id, members);
  });

  // receives this if "update" has been emitted to the server by this socket, receives the appropriate list of messages
  // according to which convo it is in
  socket.on('update', function(convo, messages, animate) {
      displayAllMessages(messages, animate);
  });

  // handle members' status change
  socket.on('status', function(members) {
      displayAllUsers(members);
  });

  // handle members' typing status change
  socket.on('typing', function(convo, nickname, isTyping) {
      changeTypingStatus(convo, nickname, isTyping);
  });

  socket.on('onerror', function(nickname, message, time) {
      displayMessage(nickname, message, time, true, true);
  });

  idleTimeDetection();

  $('#active_users_list').hide();
  $('#return').hide();
  $('#change_user').keydown(changeOnEnter);

  var name = prompt("Please choose and enter a nickname", "Anonymous");
  // forces user to enter name
  while(name === null) {
      name = prompt("Please choose and enter a nickname", "Anonymous");
  }
  $('#user').text(name);
  $('#link').val(window.location.href);
  $("#link").prop("readonly", true);
  $('#edit').click(changeName);
  $('#users').click(showUsers);
  $('#rooms').click(showRooms);
  $('#share').click(shareLink);
  $('#return').click(returnToMain);
  $('#message').on('keyup', typing);

  // join room, display list of users and group chat history
  socket.emit('join', meta('roomName'), conversation, name, function(messages, users, animate) {
      displayAllMessages(messages, animate);
      displayAllUsers(users);
      thisId = users[users.length - 1].id;
  });

  // fetch list of previously active rooms
  socket.emit('rooms', meta('roomName'), function(rooms) {
      appendPreviouslyActiveRooms(rooms);
  });

  // change and specify form's onsubmit behavior
  var messageForm = $('#messageForm').submit(sendMessage);

});

/*
 * Remove a user from the user list
 */
function removeUser(id) {
    $(users[id]).remove();
}

/*
 * Change text of convo indicator to reflect change in typing status of other user(s)
 */
function changeTypingStatus(convo, nickname, isTyping) {
    if (isTyping) {
        if (convo === conversation)
          $('#who').text(nickname + " is typing...");
    } else {
        if (conversation == 0)
          $('#who').text("Group");
        else
          $('#who').text("Private: " + nickname);
    }
}

/*
 * Determines how to handle name change event
 */
function onRename(id, members) {
    displayAllUsers(members);

    // if any part of the convo id received is the same as the current convo id, that means both users in the convo id have the private chat
    // opened and one of them changed his/her nickname
    var rooms = conversation.split(",");
    if (conversation == 0 || rooms[0] == id || rooms[1] == id) {
        // this warrants an update in the chat history to reflect the name change
        socket.emit('update', conversation);
        if(conversation != 0) {
            if(id != thisId) {
                // change the convo indicator to reflect the most updated nickname of the other user
                for (var i = 0; i < members.length; i++) {
                    if(members[i].id == id)
                    $('#who').text("Private: " + members[i].nickname);
                }
              }
          }
    }
}

/*
 * Determines how to handle new incoming message
 */
function newMessage(convo, nickname, message, time) {
    // check for if the user is currently in the private convo that received a new message, if so, append message
    if (convo === conversation) {
        displayMessage(nickname, message, time, true, false);
    } else {
        // otherwise, show notifcations
        var rooms = convo.split(",");
        if (rooms[0] == thisId || rooms[1] == thisId){
            // alert the user of a new private message if the user isn't currently in this private chat
            sendNotification(nickname);
            // increment counter and update undread messge bubble appropriately
            incrementCounter(convo);
        }
    }
}

/*
 * Update notification count as well as the unread message bubbles
 */
function incrementCounter(convo) {
    if (notifications[convo] === undefined) {
        notifications[convo] = 1;
    } else {
        notifications[convo] = notifications[convo] + 1;
    }
    var rooms = convo.split(",");
    var target = parseInt(rooms[0]);
    if(target === thisId)
        target = parseInt(rooms[1]);
    console.log(users[target]);
    var bubble = users[target].find('span')[2];
    bubble.innerText = notifications[convo];
    $(bubble).show();
}

/*
 * Handler for keyup events in the message  box to keep track of typing status
 */
function typing(e) {
    if (e.keyCode != 13) {
        if (!isTyping)
            socket.emit('typing', conversation, thisId, true);
        isTyping = true;
        clearTimeout(typingTimeout);
        // more than one second between keyups -> not typing anymore
        typingTimeout = setTimeout(notTyping, 1000);
    } else {
        // not typing on enter(message sent)
        notTyping();
    }
}

/*
 * Changes and emit status to not typing
 */
function notTyping() {
    if (isTyping) {
        isTyping = false;
        socket.emit('typing', conversation, thisId, false);
    }
}

/*
 * Returns to main conversation
 */
function returnToMain() {
    conversation = "0";
    $('#history_list').empty();
    $('#history_box').fadeOut(100, function(){
        $('#history_box').css({"background":"rgba(214, 160, 198, 0.5)"});
        $('#convo_indicator').css({"background":"rgba(255, 255, 255, 0.3)"});
        $('#who').css({"color":"#5e3953"});
        $('#who').text('Group');
        $('#return').hide();
    });
    $('#history_box').fadeIn(100, function(){
        socket.emit('conversation', conversation, function(messages, animate) {
            displayAllMessages(messages, animate);
        });
    });
}

/*
 * Show desktop notification or alert if desktop notification is not applicable
 */
function sendNotification(name) {
    // if the browser doesn't support desktop notifications or user denies it, user alerts instead
    if(!("Notification" in window) || Notification.permission === "denied") {
        alert("New private message from " + nickname);
    } else if (Notification.permission === "granted") {
        var notification = new Notification(meta('roomName') + ":" + " New message from " + name);
    } else {
        Notification.requestPermission(function(perm) {
            if (perm === "granted") {
                var notification = new Notification(meta('roomName') + ":" + " New message from " + name);
            }
        });
    }
}

/*
 * Handles the click event of the "share" button, which copies link of the chatroom to the client's clipboard
 */
function shareLink() {
    var link = document.getElementById("link");
    link.select();
    document.execCommand("Copy");
    alert("Link has been copied to clipboard, ctrl+v to share the current chatroom with friends!");
}

/*
 * Append previously active rooms to list and add click handlers to each item
 */
function appendPreviouslyActiveRooms(rooms) {
    for(var i = 0; i < rooms.length; i++) {
        var name = rooms[i].name;
        if (name !== meta('roomName')) {
            var content = '<li><div class="prev_active_room button">Chatroom:'+ name +'</div></li>';
            $('#prev_active_list').append(content);
        }
    }
    // subscribe click handler to each item in the previously ative list
    $('.prev_active_room').click(function(event) {
        // slice off the string "Chatroom:" from the div to return only the room identifier
        var room = event.target.innerText.slice(9);
        // redirect page to the room clicked
        window.location.replace('/' + room);
    });
}

/*
 * Set up interval to track idle time and emit status change when necessary
 */
function idleTimeDetection() {
    // increment the idle time counter variable every minute
    var interval = setInterval(function() {
        idleTime = idleTime + 1;
        // idle for more than 10 minutes, notify server
        if (idleTime > 9 && status === "ACTIVE") {
            socket.emit('status', "IDLE");
            status = "IDLE";
        }
    }, 60000); // increments every minute

    // reset the counter every time the mouse moves in the window
    $(this).mousemove(function() {
        // if the mouse is moved when counter is greater than 9, that means the user was previously marked as idle
        if (idleTime > 9 || status === "IDLE") {
            socket.emit('status', "ACTIVE");
            status = "ACTIVE";
        }
        idleTime = 0;
    });

    // reset the counter every time a key is pressed in the window
    $(this).keypress(function() {
        if (idleTime > 9 || status === "IDLE") {
            socket.emit('status', "ACTIVE");
            status = "ACTIVE";
        }
        idleTime = 0;
    });
}

/*
 * Show list of users and hide list of rooms
 */
function showUsers() {
    $('#prev_active_list').hide();
    $('#active_users_list').show();
    $('#rooms').css({"background": "rgba(214, 215, 216, 0.6)"});
    $('#users').css({"background": "rgba(255,255,255, 0.6)"});
}

/*
 * Show list of rooms and hide list of users
 */
function showRooms() {
    $('#prev_active_list').show();
    $('#active_users_list').hide();
    $('#users').css({"background": "rgba(214, 215, 216, 0.6)"});
    $('#rooms').css({"background": "rgba(255,255,255, 0.6)"});
}

/*
 * Show input field for changing name when "Edit" is clicked
 */
function changeName() {
    $('#user').hide();
    $('#change_user').show();
}

/*
 * When user presses enter in the name change box, the change is summited and the server is notified
 */
function changeOnEnter(event) {
    if(event.key === 'Enter') {
        var newName = $('#change_user').val();
        $('#user').show();
        $('#change_user').val('');
        $('#change_user').hide();
        $('#user').text(newName);
        socket.emit('nickname', conversation, newName);
    }
}

/*
 * Display a list of messages
 */
function displayAllMessages(messages, animate) {
    $('#history_list').empty();
    for(var i = 0; i < messages.length; i++) {
        var name = messages[i].nickname;
        var time = messages[i].time;
        var mes = messages[i].body;
        displayMessage(name, mes, time, animate, false);
    }
}

/*
 * Display a list of users
 */
function displayAllUsers(members) {
    $('#active_users_list').empty();
    for(var i = 0; i < members.length; i++) {
        displayUser(members[i].nickname, members[i].status, members[i].id);
    }
    // subscribe click handler to each item in the user list
    $('.other_user').click(function(event) {
        $('#history_box').fadeOut(100, function(){
            $('#history_box').css({"background":"rgba(175, 124, 160, 0.5)"});
            $('#convo_indicator').css({"background":"rgba(175, 124, 160, 0.5)"});
            $('#who').css({"color":"white"});
            var target = $(event.target);
            if (target.children().length != 0) {
                var user = target.find('span');
                var nickname = user[1].innerText;
            } else {
                var nickname = target.parent().find('span')[1].innerText;
            }
            $('#who').text("Private: " + nickname);
            $('#return').show();
            $('#history_list').empty();
        });
        $('#history_box').fadeIn(100, function() {
            var target = $(event.target).parent().find("input")[0].value;
            // so that the smaller number is always in the front (Ex: 11, 12 and 12, 11 are the same convo and will
            // always be represented as 11, 12)
            conversation = "" + Math.min(thisId, target) + "," + Math.max(thisId, target);
            socket.emit('conversation', conversation, function(messages, animate) {
                displayAllMessages(messages, animate);
            });
            notifications[conversation] = 0;
            $(users[parseInt(target)].find('span')[2]).hide();
        });
    });
}

/*
 * Append a message to message history list to display it
 */
function displayMessage(nickname, mes, time, animate, error) {
     var content = '<li><div class="message_content"><div class="message_header"><h3>' + nickname + '</h3><p class="time">' + time + '</p></div><p>'+ mes +'</p></div></li>';
     // if it is an error, display message in red
     if (error) content = '<li><div class="message_content"><div class="message_header"><h3>' + nickname + '</h3><p class="time">' + time + '</p></div><p class="error">'+ mes +'</p></div></li>';
     $('#history_list').append(content);
     // keep list scrolled to bottom
     if (animate){
         $('#history_list').animate({scrollTop: $('#history_list').prop("scrollHeight")}, 500);
     }
     else {
         $('#history_list').scrollTop($('#history_list').prop("scrollHeight"));
     }
 }

/*
 * Append a user to the user list
 */
function displayUser(name, status, id) {
    var count = 0;
    var convo = "" + Math.min(thisId, id) + "," + Math.max(thisId, id);
    if (notifications[convo] !== undefined) count = notifications[convo];
    var content = '<li><div class="other_user"><span class="active"></span><input type="hidden" value='+ id +'><span class="name">'+ name +'</span><span class="notification">'+ count +'</span></div></li>';
    if (status === "IDLE")
        content = '<li><div class="other_user"><span class="idle"></span><input type="hidden" value='+ id +'><span class="name">'+ name +'</span><span class="notification">'+ count +'</span></div></li>';
    // id to list item to keep track of and update notifications locally (since closing socket changes user anyhow, no
    // need for persistence using database) and to do simple modifications to the user list
    users[id] = $(content).appendTo('#active_users_list');
    if (count === 0){
        $(users[id].find('span')[2]).hide();
    }
    $('#active_users_list').scrollTop($('#active_users_list').prop("scrollHeight"));
}

/*
 * Emit message to server, supresses the default behavior of the form which redirects the page
 */
function sendMessage(event) {
    // prevent the page from redirecting
    event.preventDefault();
    var message = document.form.message.value;
    socket.emit('message', conversation, message);
    document.form.message.value = "";
}

/*
 * Get certain meta tag
 */
function meta(name) {
    var tag = document.querySelector('meta[name=' + name + ']');
    if (tag != null) {
        return tag.content;
    }
    return '';
}
