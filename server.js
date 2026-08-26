require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

const client = new MongoClient(process.env.MONGODB_URI);
let questionsCol, submissionsCol, violationsCol;

let teacherPasskey = "1234";
let currentInvigilatorDescriptor = null;
let activeTimerState = null;

async function loadQuestions() {
  return await questionsCol.find().toArray();
}

async function loadSubmissions() {
  return await submissionsCol.find().toArray();
}

async function startServer() {
  await client.connect();
  const db = client.db('cheatDetectionDB');
  questionsCol = db.collection('questions');
  submissionsCol = db.collection('submissions');
  violationsCol = db.collection('violations');
  console.log('Connected to MongoDB - cheatDetectionDB');

  io.on('connection', async (socket) => {
    socket.emit('questions-updated', await loadQuestions());
    socket.emit('submissions-updated', await loadSubmissions());
    if (currentInvigilatorDescriptor) {
      socket.emit('invigilator-face-updated', { descriptor: currentInvigilatorDescriptor });
    }
    if (activeTimerState) {
      socket.emit('start-timer', activeTimerState);
    }

    socket.on('teacher-login', (passkey, callback) => {
      if (passkey === teacherPasskey) callback({ success: true });
      else callback({ success: false, message: 'Invalid Passkey' });
    });

    socket.on('teacher-reset-passkey', ({ oldPasskey, newPasskey }, callback) => {
      if (oldPasskey !== teacherPasskey) return callback({ success: false, message: 'Incorrect old passkey' });
      if (!newPasskey || newPasskey.length < 4) return callback({ success: false, message: 'New passkey must be at least 4 characters' });
      teacherPasskey = newPasskey;
      callback({ success: true });
    });

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

    socket.on('add-question', async (text) => {
      await questionsCol.insertOne({ text });
      io.emit('questions-updated', await loadQuestions());
    });

    socket.on('edit-question', async ({ id, text }) => {
      await questionsCol.updateOne({ _id: new ObjectId(id) }, { $set: { text } });
      io.emit('questions-updated', await loadQuestions());
    });

    socket.on('delete-question', async (id) => {
      await questionsCol.deleteOne({ _id: new ObjectId(id) });
      io.emit('questions-updated', await loadQuestions());
    });

    socket.on('start-timer', (durationMinutes) => {
      activeTimerState = { remainingSeconds: durationMinutes * 60 };
      io.emit('start-timer', activeTimerState);
    });

    socket.on('student-alert', async (alertData) => {
      io.emit('teacher-notification', alertData);
      try {
        await violationsCol.insertOne(alertData);
      } catch (e) {
        console.error('Failed to save violation:', e);
      }
    });

    socket.on('submit-answers', async (data, callback) => {
      const submission = {
        student: data.student,
        regNo: data.regNo,
        submittedAt: new Date().toLocaleTimeString(),
        answers: data.answers
      };
      await submissionsCol.insertOne(submission);
      io.emit('submissions-updated', await loadSubmissions());
      if (callback) callback({ success: true });
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to connect to MongoDB:', err);
});