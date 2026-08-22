const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// In-memory data (resets if the server restarts)
let questions = [];
let questionIdCounter = 1;
let teacherPasskey = "admin123"; // default passkey — change it after first login!

io.on('connection', (socket) => {
  console.log('Client connected to WebSocket server');

  // Send the current question list to whoever just connected
  socket.emit('questions-updated', questions);

  // Student violation alerts
  socket.on('student-alert', (data) => {
    io.emit('teacher-notification', data);
  });

  // Teacher login
  socket.on('teacher-login', (passkey, callback) => {
    if (passkey === teacherPasskey) {
      callback({ success: true });
    } else {
      callback({ success: false, message: "Incorrect passkey" });
    }
  });

  // Teacher reset passkey (needs old passkey to confirm)
  socket.on('teacher-reset-passkey', ({ oldPasskey, newPasskey }, callback) => {
    if (oldPasskey !== teacherPasskey) {
      callback({ success: false, message: "Old passkey is incorrect" });
      return;
    }
    if (!newPasskey || newPasskey.trim().length < 4) {
      callback({ success: false, message: "New passkey must be at least 4 characters" });
      return;
    }
    teacherPasskey = newPasskey.trim();
    callback({ success: true });
  });

  // Add a new question
  socket.on('add-question', (text) => {
    if (!text || !text.trim()) return;
    const question = { id: questionIdCounter++, text: text.trim() };
    questions.push(question);
    io.emit('questions-updated', questions);
  });

  // Edit an existing question
  socket.on('edit-question', ({ id, text }) => {
    const q = questions.find(q => q.id === id);
    if (q && text && text.trim()) {
      q.text = text.trim();
      io.emit('questions-updated', questions);
    }
  });

  // Delete a question
  socket.on('delete-question', (id) => {
    questions = questions.filter(q => q.id !== id);
    io.emit('questions-updated', questions);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});