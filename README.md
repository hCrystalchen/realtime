BONUS FEATURES ADDED:
-	“Is typing…” notifications
-	Unread message count
-	Incoming private message desktop notifications
-	Private conversation functionality
-	Share button to copy the url

BASIC STRUCTURE
The Chatroom project consists of server side (server.js) and client side (room.js and home.js) code. room.html is a Mustache template used to generate a new chatroom, which is styled by room.css. home.html, which is styled by home.css, is a homepage that contains a link that, when clicked, would bring the user to a new chatroom with a randomly generated unique identifier. The logic for this part of the project is the same as before using get requests. Instead of setting an interval to poll the server, the room, user, and chat history lists are all maintained by using socket.io requests.

ROOMS
Each room identifier is inserted into the "room" table in the database so that a list of previously active chats can be shown on the left of each chatroom. When the user clicks on a previously active chat, the page is redirected to that chat. When a user enters a previously active room, the group chat history is appended to the page immediately. Every time a user enters a room, he/she is prompted to enter a nickname to identify him/her in the chat.

MESSAGING
When a user wants to send a message, it notifies the server by emitting the ‘message’ request along with the message to be sent. The server then determines where to send the message to by examining the conversation id (explained below) to find out whether it was from a private convo or a public convo. If the message was private, the server only sends it to the people involved in the convo. Otherwise, it is sent to all users in the room.  The client would then determine whether it would append the message depending on which conversation it is currently in. If a private message is received while the receiver is not in the convo, it is not displayed and notifications would be in place to notify the user of incoming messages (explained below). If a public message is received and the user is in a private convo, it is not displayed.

USERS and PRIVATE CONVERSATIONS
In the same panel as the list of previously active room is a tab for accessing the list of users in the current room. To the left of each user is a dot signifying the status of the user (grey if “away”, which happens when the window is idle for more than 10 minutes, and purple if “active”). An user can enter into a private conversation with anyone currently in same room by clicking on his/her name in the user list. The chat history area fades in and out and changes its color and the bar on top of it changes from “Group” to “Private: Username” to signify this change and show the user who he/she is currently talking to. Private and public convos share the same chat history area, only the messages and info displayed are different. The list is appended to when a new user enters the room and a user is removed from the list when he/she leaves the room.

RENAMING
On top of the left panel (where the previously active rooms and the user list are) is the name of the current user. The name of the user can be edited by clicking on the “edit” button to the right of the name. Upon pressing the “enter” key, the name is sent to the server and appropriate actions are taken to determine what needs to be updated on the client side of all users in the room. The user list of all users in the same room is updated to reflect this change. Additionally, depending on whether the conversation the user is in involves the user whose name has been changed, the chat history (and the name in the top bar if the convo is private) is also updated to reflect the name change to make sure that EVERYTHING is consistent. Any subsequent messages sent by the user will now be under the new name. (Updating is done by replacing the entire list with the new data. However, the action of emptying out the list and repopulating it doesn’t seem to be visible to the user from the UI perspective.)

MESSAGE NOTIFICATIONS
When a private message is sent to a user who is not currently in the private convo, desktop notifications with the room name and the name of the sender are shown to the receiver. There is also a unread message count next to the sender’s name in the user list of the receiver, which zeros out and goes away when the receiver clicks on the name of the sender and opens up the private convo.

CONVERSATIONS (PRIVATE VS. PUBLIC)
A conversation id is introduced to separate the main convo from the side convos so that clients not involved in a specific private conversation cannot access/receive any messages sent in that convo and/or send messages to that convo. This conversation id, when representing a private conversation, is a comma separated list of the user table id of the two users, with the lower number always in the front, involved in the convo. The conversation id is “0” when representing the main group convo. The convo id is checked against the user table id of the socket that requests any private info (private message history or sending a private message) to determine whether the requested data can be sent to it or not. This id is also used in the “is typing…” logic to make sure the right conversation displays the right typing status.

IS TYPING
The top bar in the chat history box displays who’s typing in the convo that the user is currently in in the form of a “Username is typing…” message. In the public group chat, only the members other than the person currently typing in the group convo receives this message. In a private chat, only the other person involved gets this message when he/she is actually in the private convo.

TOP BUTTONS
Each chatroom also contains a "Leave chat" button to redirect user back to the homepage and a “Share” button to copy the url of the page to the user’s clipboard (works in Firefox but not Chrome).
