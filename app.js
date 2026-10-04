const express = require('express');
const app = express();
const path = require("path");

const http = require("http");
const socketio = require("socket.io")
const server = http.createServer(app);
const io = socketio(server);

app.set("view engine", "ejs")
app.use(express.static(path.join(__dirname , "public" )));

// Store all connected users and their locations
const users = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Send new user all existing users' data
  socket.emit("all-users", users);

  socket.on("send-location", (data) => {
    // Store user location on server
    users[socket.id] = { id: socket.id, ...data };
    
    // Broadcast location to all users
    io.emit("receive-location", {
      id: socket.id,
      ...data,
    });
  });

  socket.on("disconnect", () => {
    // Remove user from server storage
    delete users[socket.id];
    
    // Notify all users that this user disconnected
    io.emit("user-disconnected", socket.id);
    console.log("User disconnected:", socket.id);
  });
});



app.get("/",(req,res)=>{
    res.render("index");
})

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
