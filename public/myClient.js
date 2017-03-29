'use strict';

// Clean-up function:
// collect garbage before unloading browser's window
window.onbeforeunload = function (e) {
    hangup();
}

// Data channel information
var sendChannel, receiveChannel;
var sendButton = document.getElementById("sendButton");
var sendTextarea = document.getElementById("dataChannelSend");
var receiveTextarea = document.getElementById("dataChannelReceive");

// HTML5 <video> elements
var localVideo = document.querySelector('#localVideo');
var remoteVideo = document.querySelector('#remoteVideo');

// Handler associated with 'Send' button
sendButton.onclick = sendData;

// Flags...
var isChannelReady = false;
var isInitiator = false;
var isStarted = false;

// WebRTC data structures
// Streams
var localStream;
var remoteStream;
// Peer Connection
var pc;

var pc_config = {
    'iceServers': [{
        'urls': 'stun:stun.l.google.com:19302'
    }]
};

var pc_constraints = {
    'optional': [
        { 'DtlsSrtpKeyAgreement': true }
    ]
};

var sdpConstraints = {};
/////////////////////////////////////////////

// Let's get started: prompt user for input (room name)
var room = prompt('Enter room name:');

// Connect to signalling server
var socket = io.connect();


// Send 'Create or join' message to signalling server
if (room !== '') {
    console.log('Create or join room', room);
    socket.emit('create or join', room);
}

// Set getUserMedia constraints
var constraints = { video: true, audio: true };

// From this point on, execution proceeds based on asynchronous events...

/////////////////////////////////////////////

// getUserMedia() handlers...
/////////////////////////////////////////////
function handleUserMedia(stream) {
    source: localStream = stream;
    localVideo.srcObject = stream;
    console.log('Adding local stream.');
    sendMessage('got user media');
}

function handleUserMediaError(error) {
    console.log('navigator.getUserMedia error: ', error);
}
/////////////////////////////////////////////


// Server-mediated message exchanging...
/////////////////////////////////////////////

// 1. Server-->Client...
/////////////////////////////////////////////

// Handle 'created' message coming back from server:
// this peer is the initiator
socket.on('created', function (room) {
    console.log('Created room ' + room);
    isInitiator = true;

    navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
    console.log('Getting user media with constraints', constraints);

    checkAndStart();
});

// Handle 'full' message coming back from server:
// this peer arrived too late :-(
socket.on('full', function (room) {
    console.log('Room ' + room + ' is full');
});

// Handle 'join' message coming back from server:
// another peer is joining the channel
socket.on('join', function (room) {
    console.log('Another peer made a request to join room ' + room);
    console.log('This peer is the initiator of room ' + room + '!');
    isChannelReady = true;
});

// Handle 'joined' message coming back from server:
// this is the second peer joining the channel
socket.on('joined', function (room) {
    console.log('This peer has joined room ' + room + " All right");
    isChannelReady = true;

    // Call getUserMedia()
    navigator.mediaDevices.getUserMedia(constraints).then(handleUserMedia).catch(handleUserMediaError);
    console.log('Getting user media with constraints', constraints);
});

// Server-sent log message...
socket.on('log', function (array) {
    console.log.apply(console, array);
});

// Receive message from the other peer via the signalling server 
socket.on('message', function (message) {
    console.log('Received message:', message);
    if (message.message === 'got user media') {
        console.log("Check got user media");
        checkAndStart();
    } else if (message.message.type === 'offer') {
        if (!isInitiator && !isStarted) {
            checkAndStart();
        }
        pc.setRemoteDescription(new RTCSessionDescription(message.message));
        doAnswer();
    } else if (message.message.type === 'answer' && isStarted) {
        pc.setRemoteDescription(new RTCSessionDescription(message.message));
    } else if (message.message.type === 'candidate' && isStarted) {
        var candidate = new RTCIceCandidate({
            sdpMLineIndex: message.message.label,
            candidate: message.message.candidate
        });
        pc.addIceCandidate(candidate);
    } else if (message.message === 'bye' && isStarted) {
        handleRemoteHangup();
    }
});
////////////////////////////////////////////////

// 2. Client-->Server
////////////////////////////////////////////////
// Send message to the other peer via the signalling server
function sendMessage(message) {
    console.log('Sending message: ', message);
    socket.emit('message', {
        channel: room,
        message: message
    });
}
////////////////////////////////////////////////////

////////////////////////////////////////////////////
// Channel negotiation trigger function
function checkAndStart() {
    if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
        createPeerConnection();
        isStarted = true;
        if (isInitiator) {
            doCall();
        }
    }
}

/////////////////////////////////////////////////////////
// Peer Connection management...
function createPeerConnection() {
    try {
        pc = new RTCPeerConnection(pc_config, pc_constraints);
        pc.addStream(localStream);
        pc.onicecandidate = handleIceCandidate;
        console.log('Created RTCPeerConnnection with:\n' +
            '  config: \'' + JSON.stringify(pc_config) + '\';\n' +
            '  constraints: \'' + JSON.stringify(pc_constraints) + '\'.');
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        alert('Cannot create RTCPeerConnection object.');
        return;
    }
    pc.onaddstream = handleRemoteStreamAdded;
    pc.onremovestream = handleRemoteStreamRemoved;

    if (isInitiator) {
        try {
            // Create a reliable data channel
            sendChannel = pc.createDataChannel("sendDataChannel",
                { reliable: true });
            //trace('Created send data channel');
            console.log('Created send data channel')
        } catch (e) {
            alert('Failed to create data channel. ');
            //trace('createDataChannel() failed with exception: ' + e.message);
            console.log('createDataChannel() failed with exception: ' + e.message);
            console.trace();
        }
        sendChannel.onopen = handleSendChannelStateChange;
        sendChannel.onmessage = handleMessage;
        sendChannel.onclose = handleSendChannelStateChange;
    } else { // Joiner
        pc.ondatachannel = gotReceiveChannel;
    }
}

// Data channel management
function sendData() {
    var data = sendTextarea.value;
    if (isInitiator) sendChannel.send(data);
    else receiveChannel.send(data);
    receiveTextarea.value += "You" + ": " + data + '\n';
    console.log('Sent data: ' + data);
}

// Handlers...

function gotReceiveChannel(event) {
    //trace('Receive Channel Callback');
    console.log('Receive Channel Callback');
    receiveChannel = event.channel;
    receiveChannel.onmessage = handleMessage;
    receiveChannel.onopen = handleReceiveChannelStateChange;
    receiveChannel.onclose = handleReceiveChannelStateChange;
}

function handleMessage(event) {
    //trace('Received message: ' + event.data);
    console.log('Received message: ' + event.data)
    receiveTextarea.value += "Callee" + ": " + event.data + '\n';
}

function handleSendChannelStateChange() {
    var readyState = sendChannel.readyState;
    //trace('Send channel state is: ' + readyState);
    console.log('Send channel state is: ' + readyState);
    // If channel ready, enable user's input
    if (readyState == "open") {
        dataChannelSend.disabled = false;
        dataChannelSend.focus();
        dataChannelSend.placeholder = "";
        sendButton.disabled = false;
    } else {
        dataChannelSend.disabled = true;
        sendButton.disabled = true;
    }
}

function handleReceiveChannelStateChange() {
    var readyState = receiveChannel.readyState;
    //trace('Receive channel state is: ' + readyState);
    console.log('Receive channel state is: ' + readyState);
    // If channel ready, enable user's input
    if (readyState == "open") {
        dataChannelSend.disabled = false;
        dataChannelSend.focus();
        dataChannelSend.placeholder = "";
        sendButton.disabled = false;
    } else {
        dataChannelSend.disabled = true;
        sendButton.disabled = true;
    }
}

// ICE candidates management
function handleIceCandidate(event) {
    console.log('handleIceCandidate event: ', event);
    if (event.candidate) {
        sendMessage({
            type: 'candidate',
            label: event.candidate.sdpMLineIndex,
            id: event.candidate.sdpMid,
            candidate: event.candidate.candidate
        });
    } else {
        console.log('End of candidates.');
    }
}

// Create Offer
function doCall() {
    console.log('Creating Offer...');
    //pc.createOffer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
    pc.createOffer().then(setLocalAndSendMessage, onSignalingError);
}

// Signalling error handler
function onSignalingError(error) {
    console.log('Failed to create signaling message : ' + error.name);
}

// Create Answer
function doAnswer() {
    console.log('Sending answer to peer.');
    //pc.createAnswer(setLocalAndSendMessage, onSignalingError, sdpConstraints);
    pc.createAnswer().then(setLocalAndSendMessage, onSignalingError);
}

// Success handler for both createOffer()
// and createAnswer()
function setLocalAndSendMessage(sessionDescription) {
    pc.setLocalDescription(sessionDescription);
    sendMessage(sessionDescription);
}

/////////////////////////////////////////////////////////
// Remote stream handlers...

function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteVideo.srcObject = event.stream;
    remoteStream = event.stream;
}

function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
}
/////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////
// Clean-up functions...

function hangup() {
    console.log('Hanging up.');
    stop();
    sendMessage('bye');
}

function handleRemoteHangup() {
    console.log('Session terminated.');
    stop();
    isInitiator = false;
}

function stop() {
    isStarted = false;
    if (sendChannel) sendChannel.close();
    if (receiveChannel) receiveChannel.close();
    if (pc) pc.close();
    pc = null;
    sendButton.disabled = true;
}