/*
 * MIT License
 *
 * Copyright (c) 2020 Nhan Cao
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

'use strict';
// https://github.com/webrtc/samples/tree/gh-pages/src/content/peerconnection/pc1
const clientIdP = document.getElementById('clientId');
const calleeIdInput = document.getElementById('calleeIdInput');
const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1
};
let startTime;
let localStream;
let peerConnection;

// @nhancv 3/30/20: Init state
startButton.disabled = true;
calleeIdInput.disabled = true;
callButton.disabled = true;
hangupButton.disabled = true;

///////////////////////////////////////////////////
// Handle socket event
// Connected to socket server and enable start button, otherwise disable it
// Connect to server and receive an socket client id
// Prepare local media
// Create an offer and send a pair (callee id, offer description) to server
// Server will forward that offer description to callee via id
// Callee receive offer and generate answer and send a pair (caller id, answer description) to server
// Server will forward that answer description to caller id
// Caller receive answer, two peer continue exchange ice candidate information via socket server
//

const CLIENT_ID_EVENT = 'client-id-event';
const OFFER_EVENT = 'offer-event';
const ANSWER_EVENT = 'answer-event';
const ICE_CANDIDATE_EVENT = 'ice-candidate-event';

let currentClientId = null;
let calleeId = null;

const socket = io('https://192.168.1.128:3000');
// const socket = io('http://localhost:3000');
socket.on('connect', function () {
  console.log('Connected');
  // @nhancv 3/30/20: Enable Start button
  startButton.disabled = false;
  
  // @nhancv 3/30/20: Socket event setup
  socket.on(CLIENT_ID_EVENT, function (_clientId) {
    console.log(CLIENT_ID_EVENT, _clientId);
    currentClientId = _clientId;
    clientIdP.innerHTML = `Client ID: ${_clientId}`;
  });
  
  socket.on(OFFER_EVENT, async (description) => {
    console.log(OFFER_EVENT, description);
    
    // @nhancv 3/30/20: Create new PeerConnection
    startTime = window.performance.now();
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    if (videoTracks.length > 0) {
      console.log(`Using video device: ${videoTracks[0].label}`);
    }
    if (audioTracks.length > 0) {
      console.log(`Using audio device: ${audioTracks[0].label}`);
    }
    peerConnection = new RTCPeerConnection({});
    console.log('Created remote peer connection object ' + currentClientId);
    peerConnection.addEventListener('icecandidate', e => onIceCandidate(e));
    peerConnection.addEventListener('iceconnectionstatechange', e => onIceStateChange(e));
    peerConnection.addEventListener('track', gotRemoteStream);
    
    // Set remote offer
    console.log(currentClientId + ' setRemoteDescription start');
    try {
      await peerConnection.setRemoteDescription(description);
      onSetRemoteSuccess(peerConnection);
    } catch (e) {
      onSetSessionDescriptionError();
    }
    
    console.log(currentClientId + ' createAnswer start');
    // Since the 'remote' side has no media stream we need
    // to pass in the right constraints in order for it to
    // accept the incoming offer of audio and video.
    try {
      const answer = await peerConnection.createAnswer();
      await onCreateAnswerSuccess(answer);
      // @nhancv 3/30/20: Send answer to callee
      emitAnswerEvent(calleeId, answer);
    } catch (e) {
      onCreateSessionDescriptionError(e);
    }
  });
  
  socket.on(ANSWER_EVENT, async (description) => {
    console.log(ANSWER_EVENT, description);
    console.log(currentClientId + ' setRemoteDescription start');
    try {
      await peerConnection.setRemoteDescription(description);
      onSetRemoteSuccess(peerConnection);
    } catch (e) {
      onSetSessionDescriptionError(e);
    }
  });
  
  socket.on(ICE_CANDIDATE_EVENT, async (candidate) => {
    console.log(ICE_CANDIDATE_EVENT, candidate);
    try {
      await peerConnection.addIceCandidate(candidate);
      onAddIceCandidateSuccess();
    } catch (e) {
      onAddIceCandidateError(e);
    }
    console.log(`ICE candidate:\n${candidate ? candidate.candidate : '(null)'}`);
  });
  
  socket.on('exception', function (exception) {
    console.log('exception', exception);
  });
  socket.on('disconnect', function () {
    console.log('Disconnected');
    // @nhancv 3/30/20: Disable Start button
    startButton.disabled = true;
  });
});

function emitOfferEvent(peerId, description) {
  if (socket && socket.connected) {
    socket.emit(OFFER_EVENT, {peerId: peerId, description: description})
  }
}

function emitAnswerEvent(peerId, description) {
  if (socket && socket.connected) {
    socket.emit(ANSWER_EVENT, {peerId: peerId, description: description})
  }
}

function emitIceCandidateEvent(isHost, candidate) {
  if (socket && socket.connected) {
    socket.emit(ICE_CANDIDATE_EVENT, {isHost: isHost, candidate: candidate})
  }
}


///////////////////////////////////////////////////
startButton.addEventListener('click', start);
callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

localVideo.addEventListener('loadedmetadata', function () {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('loadedmetadata', function () {
  console.log(`Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
});

remoteVideo.addEventListener('resize', () => {
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    const elapsedTime = window.performance.now() - startTime;
    console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
});

async function start() {
  console.log('Requesting local stream');
  startButton.disabled = true;
  try {
    // Older browsers might not implement mediaDevices at all, so we set an empty object first
    if (navigator.mediaDevices === undefined) {
      navigator.mediaDevices = {};
    }

    // Some browsers partially implement mediaDevices. We can't just assign an object
    // with getUserMedia as it would overwrite existing properties.
    // Here, we will just add the getUserMedia property if it's missing.
    if (navigator.mediaDevices.getUserMedia === undefined) {
      navigator.mediaDevices.getUserMedia = function (constraints) {

        // First get ahold of the legacy getUserMedia, if present
        let getUserMedia = navigator.mozGetUserMedia || navigator.webkitGetUserMedia || navigator.msGetUserMedia;

        // Some browsers just don't implement it - return a rejected promise with an error
        // to keep a consistent interface
        if (!getUserMedia) {
          return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
        }

        // Otherwise, wrap the call to the old navigator.getUserMedia with a Promise
        return new Promise(function (resolve, reject) {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      }
    }
    
    // const constraints = { audio: true, video: true };
    const constraints = {audio: true, video: {facingMode: "user"}};
    // const constraints = {audio: true, video: {facingMode: {exact: "environment"}}};
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Received local stream');
    localVideo.srcObject = stream;
    localStream = stream;
    callButton.disabled = false;
    calleeIdInput.disabled = false;
  } catch (e) {
    alert(`getUserMedia() error: ${e.message}`);
    console.error(e);
  }
}

async function call() {
  // @nhancv 3/30/20: Save calleeID
  calleeId = calleeIdInput.value;
  // @nhancv 3/30/20: Update control status
  callButton.disabled = true;
  calleeIdInput.disabled = true;
  hangupButton.disabled = false;
  console.log('Starting call');
  startTime = window.performance.now();
  const videoTracks = localStream.getVideoTracks();
  const audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    console.log(`Using video device: ${videoTracks[0].label}`);
  }
  if (audioTracks.length > 0) {
    console.log(`Using audio device: ${audioTracks[0].label}`);
  }
  peerConnection = new RTCPeerConnection({});
  console.log('Created local peer connection object ' + currentClientId);
  peerConnection.addEventListener('icecandidate', e => onIceCandidate(e));
  peerConnection.addEventListener('iceconnectionstatechange', e => onIceStateChange(e));
  peerConnection.addEventListener('track', gotRemoteStream);
  
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  console.log('Added local stream to ' + currentClientId);
  
  try {
    console.log(currentClientId + ' createOffer start');
    const offer = await peerConnection.createOffer(offerOptions);
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) {
  console.log(`Offer from ${currentClientId}\n${desc}`);
  console.log(currentClientId + ' setLocalDescription start');
  try {
    await peerConnection.setLocalDescription(desc);
    onSetLocalSuccess();
    // @nhancv 3/30/20: Send offer to callee
    emitOfferEvent(calleeId, desc);
  } catch (e) {
    onSetSessionDescriptionError();
  }
  
}

function onSetLocalSuccess() {
  console.log(`peerConnection setLocalDescription complete`);
}

function onSetRemoteSuccess() {
  console.log(`peerConnection setRemoteDescription complete`);
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

function gotRemoteStream(e) {
  const remoteStream = e.streams[0];
  if (remoteVideo.srcObject !== remoteStream) {
    remoteVideo.srcObject = remoteStream;
    remoteStream.getTracks().forEach(track => peerConnection.addTrack(track, remoteStream));
    console.log('peerConnection received remote stream');
  }
}

async function onCreateAnswerSuccess(desc) {
  console.log(`Answer from ${currentClientId}:\n${desc}`);
  console.log(currentClientId + ' setLocalDescription start');
  try {
    await peerConnection.setLocalDescription(desc);
    onSetLocalSuccess();
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

async function onIceCandidate(event) {
  try {
    // @nhancv 3/30/20: Send ice Candidate
    emitIceCandidateEvent(!(calleeId == null), event.candidate);
    onAddIceCandidateSuccess();
  } catch (e) {
    onAddIceCandidateError(e);
  }
  console.log(`peerConnection ICE candidate:\n${event.candidate ? event.candidate.candidate : '(null)'}`);
}

function onAddIceCandidateSuccess() {
  console.log(`peerConnection addIceCandidate success`);
}

function onAddIceCandidateError(error) {
  console.log(`peerConnection failed to add ICE Candidate: ${error.toString()}`);
}

function onIceStateChange(event) {
  if (peerConnection) {
    console.log(`peerConnection ICE state: ${peerConnection.iceConnectionState}`);
    console.log('ICE state change event: ', event);
    if (peerConnection.iceConnectionState === 'disconnected') {
      peerConnection.close();
      peerConnection = null;
      remoteVideo.srcObject = null;
      hangup();
    }
  }
}

function hangup() {
  console.log('Ending call');
  try {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    calleeId = null;
    hangupButton.disabled = true;
    callButton.disabled = false;
    calleeIdInput.disabled = false;
    remoteVideo.srcObject = null;
  } catch (e) {
    console.error(e);
  }
}