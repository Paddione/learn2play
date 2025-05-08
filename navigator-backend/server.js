    // navigator-backend/server.js
    const express = require('express');
    const http = require('http');
    const { Server } = require("socket.io");
    const cors = require('cors');

    const PORT = process.env.PORT || 4000; // Use environment variable or default

    const app = express();
    // Enable CORS for all origins - adjust for production if needed
    app.use(cors());

    const server = http.createServer(app);

    // Initialize Socket.IO server with CORS configuration
    const io = new Server(server, {
      cors: {
        origin: "*", // Allow all origins - RESTRICT THIS IN PRODUCTION!
        methods: ["GET", "POST"]
      }
    });

    // --- Game State Management ---
    // Simple in-memory store for rooms. Replace with a database for persistence.
    let rooms = {};
    const MAX_PLAYERS_PER_ROOM = 5;

    // --- Helper Functions ---
    function generateRoomId() {
      // Simple room ID generator (replace with something more robust if needed)
      return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    function getRoomState(roomId) {
        // Returns a safe-to-send version of the room state
        if (!rooms[roomId]) return null;
        // Avoid sending sensitive data if any exists
        return {
            roomId: roomId,
            players: rooms[roomId].players,
            gameState: rooms[roomId].gameState
        };
    }

    // --- Socket.IO Event Handling ---
    io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // --- Room Management Events ---
      socket.on('createRoom', ({ playerName }) => {
          const roomId = generateRoomId();
          socket.join(roomId);
          rooms[roomId] = {
              roomId: roomId,
              players: {
                  [socket.id]: { id: socket.id, name: playerName || `Player_${socket.id.substring(0,4)}`, character: null, isReady: false, score: 0 }
              },
              gameState: {
                  levelIndex: 0,
                  levelState: 'waiting', // waiting, intro, study, challenge, level_complete
                  // Add other initial game state properties here
              },
              maxPlayers: MAX_PLAYERS_PER_ROOM
          };
          console.log(`Room ${roomId} created by ${socket.id}`);
          // Send room details back to the creator
          socket.emit('roomCreated', getRoomState(roomId));
          // Optionally broadcast room availability if you have a lobby system
      });

      socket.on('joinRoom', ({ roomId, playerName }) => {
          if (!rooms[roomId]) {
              socket.emit('error', { message: `Room ${roomId} not found.` });
              return;
          }
          if (Object.keys(rooms[roomId].players).length >= rooms[roomId].maxPlayers) {
              socket.emit('error', { message: `Room ${roomId} is full.` });
              return;
          }

          socket.join(roomId);
          rooms[roomId].players[socket.id] = { id: socket.id, name: playerName || `Player_${socket.id.substring(0,4)}`, character: null, isReady: false, score: 0 };
          console.log(`User ${socket.id} joined room ${roomId}`);

          // Notify player they joined successfully and send current state
          socket.emit('joinedRoom', getRoomState(roomId));

          // Notify others in the room about the new player
          socket.to(roomId).emit('playerJoined', rooms[roomId].players[socket.id]);
          // Send updated full state to everyone in the room
          io.to(roomId).emit('gameStateUpdate', getRoomState(roomId));
      });

        socket.on('leaveRoom', ({ roomId }) => {
            if (rooms[roomId] && rooms[roomId].players[socket.id]) {
                console.log(`User ${socket.id} leaving room ${roomId}`);
                socket.leave(roomId);
                const leavingPlayer = rooms[roomId].players[socket.id];
                delete rooms[roomId].players[socket.id];

                // Notify others
                socket.to(roomId).emit('playerLeft', { playerId: socket.id, playerName: leavingPlayer.name });
                 // Send updated full state
                 io.to(roomId).emit('gameStateUpdate', getRoomState(roomId));


                // Optional: Delete room if empty
                if (Object.keys(rooms[roomId].players).length === 0) {
                    console.log(`Room ${roomId} is empty, deleting.`);
                    delete rooms[roomId];
                }
            }
        });


      // --- Game Specific Events ---

      socket.on('selectCharacter', ({ roomId, character }) => {
          if (rooms[roomId] && rooms[roomId].players[socket.id]) {
              rooms[roomId].players[socket.id].character = character;
              console.log(`Player ${socket.id} in room ${roomId} selected ${character}`);
              // Broadcast the choice to others in the room
              io.to(roomId).emit('playerSelectedCharacter', { playerId: socket.id, character: character });
               // Send updated full state
               io.to(roomId).emit('gameStateUpdate', getRoomState(roomId));

              // Check if all players have selected characters to start the game
              const allSelected = Object.values(rooms[roomId].players).every(p => p.character !== null);
              if (allSelected && rooms[roomId].gameState.levelState === 'waiting') {
                  console.log(`All players in room ${roomId} ready. Starting game.`);
                  rooms[roomId].gameState.levelState = 'intro'; // Move to first level intro
                  io.to(roomId).emit('startGame', getRoomState(roomId)); // Notify clients to start
              }
          }
      });

      socket.on('playerReady', ({ roomId, readyState }) => {
          // Handle players indicating readiness (e.g., after intro/study, before challenge)
          if (rooms[roomId] && rooms[roomId].players[socket.id]) {
              rooms[roomId].players[socket.id].isReady = readyState;
              console.log(`Player ${socket.id} in room ${roomId} readiness: ${readyState}`);
              io.to(roomId).emit('playerReadinessUpdate', { playerId: socket.id, isReady: readyState });
               // Send updated full state
               io.to(roomId).emit('gameStateUpdate', getRoomState(roomId));


              // --- Synchronization Logic Example ---
              // Check if all players are ready to proceed (e.g., start challenge)
              const allReady = Object.values(rooms[roomId].players).every(p => p.isReady);
              const currentState = rooms[roomId].gameState.levelState;

              if (allReady && (currentState === 'intro' || currentState === 'study')) {
                   console.log(`All players in room ${roomId} ready to start challenge.`);
                   // Reset readiness for the next sync point
                   Object.values(rooms[roomId].players).forEach(p => p.isReady = false);
                   rooms[roomId].gameState.levelState = 'challenge';
                   io.to(roomId).emit('startChallenge', getRoomState(roomId)); // Send updated state
               } else if (allReady && currentState === 'level_complete') {
                   // Logic to move to the next level
                   console.log(`All players in room ${roomId} ready for next level.`);
                   Object.values(rooms[roomId].players).forEach(p => p.isReady = false);
                   rooms[roomId].gameState.levelIndex += 1; // Check bounds!
                   // Check if game ended
                   // const totalLevels = 3; // Get this from your game data
                   // if (rooms[roomId].gameState.levelIndex >= totalLevels) {
                   //   io.to(roomId).emit('gameEnd', getRoomState(roomId));
                   // } else {
                        rooms[roomId].gameState.levelState = 'intro';
                        io.to(roomId).emit('nextLevel', getRoomState(roomId));
                   // }
               }
          }
      });

      socket.on('submitAnswer', ({ roomId, answerData }) => {
          // Placeholder: Handle challenge answer submission
          // - Validate answer (server-side if needed)
          // - Update player score/progress in rooms[roomId]
          // - Broadcast result/progress update
          // - Check if challenge/level is complete for the player/team
          console.log(`Player ${socket.id} in room ${roomId} submitted answer:`, answerData);
          // Example: Update score (replace with real logic)
          if (rooms[roomId] && rooms[roomId].players[socket.id]) {
               rooms[roomId].players[socket.id].score += 10; // Dummy score increase
               // Broadcast the score update
               io.to(roomId).emit('scoreUpdate', { playerId: socket.id, newScore: rooms[roomId].players[socket.id].score });
               io.to(roomId).emit('gameStateUpdate', getRoomState(roomId)); // Send full state too

                // --- Synchronization Logic Example ---
                // Check if all players have completed the challenge step/level
                // This requires more complex state tracking per challenge
                // If challenge complete for all:
                // rooms[roomId].gameState.levelState = 'level_complete';
                // Object.values(rooms[roomId].players).forEach(p => p.isReady = false); // Reset readiness
                // io.to(roomId).emit('challengeComplete', getRoomState(roomId));
           }
       });

      // --- Disconnect Handling ---
      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Find which room the player was in and remove them
        for (const roomId in rooms) {
          if (rooms[roomId].players[socket.id]) {
             console.log(`Removing ${socket.id} from room ${roomId}`);
             const leavingPlayerName = rooms[roomId].players[socket.id].name;
             delete rooms[roomId].players[socket.id];

             // Notify others in the room
             socket.to(roomId).emit('playerLeft', { playerId: socket.id, playerName: leavingPlayerName });
             // Send updated full state
             io.to(roomId).emit('gameStateUpdate', getRoomState(roomId));


             // Optional: Delete room if empty
             if (Object.keys(rooms[roomId].players).length === 0) {
               console.log(`Room ${roomId} is empty, deleting.`);
               delete rooms[roomId];
             }
             break; // Exit loop once player is found and removed
           }
         }
      });

    }); // End of io.on('connection')

    // Basic HTTP route (optional)
    app.get('/', (req, res) => {
      res.send('Netzwerk Navigatoren Backend is running!');
    });

    // Start the server
    server.listen(PORT, () => {
      console.log(`Server listening on *:${PORT}`);
    });
    