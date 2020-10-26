$(document).ready(function() {
    $('#chat').click(function() {
        // get random identifier on click and redirect to that page
        $.get('/chatroom', function(res) {
            window.location.replace('/' + res.room);
        });
    });
});
