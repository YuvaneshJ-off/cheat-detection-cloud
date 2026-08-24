const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const MONGO_URI = "mongodb+srv://yuvaneshoffia1_db_user:eYul5Bjat9d2DVYP@cluster0.pabnxio.mongodb.net/?appName=Cluster0";
const client = new MongoClient(MONGO_URI);
let questionsCollection, violationsCollection, settingsCollection, submissionsCollection;
let teacherPasskey = "admin123";
let activeExamTimer = null;

async function connectDB() {
  try {
    await client.connect();
    const db = client.db("cheatDetectionDB");
    questionsCollection = db.collection("questions");
    violationsCollection = db.collection("violations");
    settingsCollection = db.collection("settings");
    submissionsCollection = db.collection("submissions");

    const savedSettings = await settingsCollection.findOne({ _id: "teacherConfig" });
    if (savedSettings && savedSettings.passkey) {
      teacherPasskey = savedSettings.passkey;
    } else {
      await settingsCollection.insertOne({ _id: "teacherConfig", passkey: teacherPasskey });
    }
    console.log("Connected to MongoDB Atlas");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
}
connectDB();

io.on('connection', async (socket) => {
  console.log('Client connected to WebSocket server');

  if (questionsCollection) {
    const questions = await questionsCollection.find().sort({ _id: 1 }).toArray();
    socket.emit('questions-updated', questions);
  }

  if (submissionsCollection) {
    const submissions = await submissionsCollection.find().sort({ _id: -1 }).toArray();
    socket.emit('submissions-updated', submissions);
  }

  if (activeExamTimer) {
    const elapsedSeconds = Math.floor((Date.now() - activeExamTimer.startTime) / 1000);
    const remainingSeconds = (activeExamTimer.durationMinutes * 60) - elapsedSeconds;
    if (remainingSeconds > 0) {
      socket.emit('start-timer', {
        durationMinutes: activeExamTimer.durationMinutes,
        remainingSeconds: remainingSeconds
      });
    }
  }

  socket.on('start-timer', (durationMinutes) => {
    activeExamTimer = {
      durationMinutes: Number(durationMinutes),
      startTime: Date.now()
    };
    io.emit('start-timer', {
      durationMinutes: activeExamTimer.durationMinutes,
      remainingSeconds: activeExamTimer.durationMinutes * 60
    });
  });

  socket.on('student-alert', async (data) => {
    io.emit('teacher-notification', data);
    if (violationsCollection) {
      await violationsCollection.insertOne(data);
    }
  });

  socket.on('teacher-login', (passkey, callback) => {
    if (passkey === teacherPasskey) {
      callback({ success: true });
    } else {
      callback({ success: false, message: "Incorrect passkey" });
    }
  });

  socket.on('teacher-reset-passkey', async ({ oldPasskey, newPasskey }, callback) => {
    if (oldPasskey !== teacherPasskey) {
      callback({ success: false, message: "Old passkey is incorrect" });
      return;
    }
    if (!newPasskey || newPasskey.trim().length < 4) {
      callback({ success: false, message: "New passkey must be at least 4 characters" });
      return;
    }
    teacherPasskey = newPasskey.trim();
    if (settingsCollection) {
      await settingsCollection.updateOne(
        { _id: "teacherConfig" },
        { $set: { passkey: teacherPasskey } }
      );
    }
    callback({ success: true });
  });

  socket.on('add-question', async (text) => {
    if (!text || !text.trim() || !questionsCollection) return;
    await questionsCollection.insertOne({ text: text.trim() });
    const questions = await questionsCollection.find().sort({ _id: 1 }).toArray();
    io.emit('questions-updated', questions);
  });

  socket.on('edit-question', async ({ id, text }) => {
    if (!questionsCollection) return;
    await questionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { text: text.trim() } }
    );
    const questions = await questionsCollection.find().sort({ _id: 1 }).toArray();
    io.emit('questions-updated', questions);
  });

  socket.on('delete-question', async (id) => {
    if (!questionsCollection) return;
    await questionsCollection.deleteOne({ _id: new ObjectId(id) });
    const questions = await questionsCollection.find().sort({ _id: 1 }).toArray();
    io.emit('questions-updated', questions);
  });

  socket.on('submit-answers', async (data, callback) => {
    if (!submissionsCollection) {
      if (callback) callback({ success: false, message: "Database not ready, try again." });
      return;
    }
    const submission = {
      student: data.student,
      regNo: data.regNo,
      answers: data.answers,
      submittedAt: new Date().toLocaleString()
    };
    await submissionsCollection.insertOne(submission);
    const submissions = await submissionsCollection.find().sort({ _id: -1 }).toArray();
    io.emit('submissions-updated', submissions);
    if (callback) callback({ success: true });
  });
});

app.use(express.json());

app.post("/api/hardware/rfid", (req, res) => {
  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ ok: false, message: "RFID UID is required" });
  }
  console.log("Hardware RFID:", uid);
  io.emit("hardwareStudentDetected", { uid: uid, time: new Date().toISOString() });
  res.json({ ok: true, message: "RFID received" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});