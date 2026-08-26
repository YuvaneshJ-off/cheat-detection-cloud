const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

let teacherPasskey = "1234";
let questions = [];
let submissions = [];
let currentInvigilatorDescriptor = null;
let activeTimerState = null;

io.on('connection', (socket) => {
  // Sync state on connection
  socket.emit('questions-updated', questions);
  socket.emit('submissions-updated', submissions);
  if (currentInvigilatorDescriptor) {
    socket.emit('invigilator-face-updated', { descriptor: currentInvigilatorDescriptor });
  }
  if (activeTimerState) {
    socket.emit('start-timer', activeTimerState);
  }

  // Teacher Auth
  socket.on('teacher-login', (passkey, callback) => {
    if (passkey === teacherPasskey) {
      callback({ success: true });
    } else {
      callback({ success: false, message: 'Invalid Passkey' });
    }
  });

  socket.on('teacher-reset-passkey', ({ oldPasskey, newPasskey }, callback) => {
    if (oldPasskey !== teacherPasskey) {
      return callback({ success: false, message: 'Incorrect old passkey' });
    }
    if (!newPasskey || newPasskey.length < 4) {
      return callback({ success: false, message: 'New passkey must be at least 4 characters' });
    }
    teacherPasskey = newPasskey;
    callback({ success: true });
  });

  // Invigilator Face Handlers
  socket.on('set-invigilator-face', (descriptorArray, callback) => {
    currentInvigilatorDescriptor = descriptorArray;
    io.emit('invigilator-face-updated', { descriptor: descriptorArray });
    if (callback) callback({ success: true });
  });

  socket.on('clear-invigilator-face', (data, callback) => {
    currentInvigilatorDescriptor = null;
    io.emit('invigilator-face-updated', { descriptor: null });
    if (callback) callback({ success: true });
  });

  // Questions
  socket.on('add-question', (text) => {
    questions.push({ _id: Date.now().toString(), text });
    io.emit('questions-updated', questions);
  });

  socket.on('edit-question', ({ id, text }) => {
    const q = questions.find(q => q._id === id);
    if (q) q.text = text;
    io.emit('questions-updated', questions);
  });

  socket.on('delete-question', (id) => {
    questions = questions.filter(q => q._id !== id);
    io.emit('questions-updated', questions);
  });

  // Timer
  socket.on('start-timer', (durationMinutes) => {
    activeTimerState = { remainingSeconds: durationMinutes * 60 };
    io.emit('start-timer', activeTimerState);
  });

  // Proctoring Alerts
  socket.on('student-alert', (alertData) => {
    io.emit('teacher-notification', alertData);
  });

  // Submissions
  socket.on('submit-answers', (data, callback) => {
    submissions.push({
      student: data.student,
      regNo: data.regNo,
      submittedAt: new Date().toLocaleTimeString(),
      answers: data.answers
    });
    io.emit('submissions-updated', submissions);
    if (callback) callback({ success: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});