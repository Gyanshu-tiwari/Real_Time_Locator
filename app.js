const express = require('express');
const app = express();
const path = require("path");

const http = require("http");
const socketio = require("socket.io")
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname , "public" )));

// Store all connected users keyed by their persistent deviceId
// Format: { [deviceId]: { id: deviceId, socketId, latitude, longitude, accuracy, lastSeen } }
const users = {};
const socketToDevice = {};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Send new user all currently active devices
  socket.emit("all-users", users);

  // Register deviceId on connection
  socket.on("register-device", (deviceId) => {
    if (!deviceId) return;
    socketToDevice[socket.id] = deviceId;
    if (users[deviceId]) {
      users[deviceId].socketId = socket.id;
    }
  });

  socket.on("send-location", (data) => {
    const { deviceId, latitude, longitude, accuracy } = data;
    if (!deviceId) return;

    socketToDevice[socket.id] = deviceId;
    
    // Store user location keyed by persistent deviceId
    users[deviceId] = {
      id: deviceId,
      socketId: socket.id,
      latitude,
      longitude,
      accuracy,
      lastSeen: Date.now()
    };
    
    // Broadcast location to all connected clients
    io.emit("receive-location", users[deviceId]);
  });

  socket.on("disconnect", () => {
    const deviceId = socketToDevice[socket.id];
    delete socketToDevice[socket.id];
    
    if (deviceId) {
      // 4-second grace period: if the device reconnected on a new socket, don't remove it
      setTimeout(() => {
        if (users[deviceId] && users[deviceId].socketId === socket.id) {
          delete users[deviceId];
          io.emit("user-disconnected", deviceId);
          console.log("Device officially disconnected:", deviceId);
        }
      }, 4000);
    }
  });
});



app.get("/",(req,res)=>{
    res.render("index");
})

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
