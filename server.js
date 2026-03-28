const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// UPDATED: Added CORS configuration for Vercel
const io = new Server(server, {
  cors: {
    origin: "https://pleaseignore.vercel.app",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname)));

const rooms = {};

// ─── Room Layout & Adjacency ───────────────────────────────────────────────
const ADJACENCY = {
  FRONT_AREA:       ['PORCH', 'LIVING_ROOM', 'KITCHEN'],
  PORCH:            ['FRONT_AREA', 'BEDROOM'],
  LIVING_ROOM:      ['FRONT_AREA', 'KITCHEN', 'BEDROOM'],
  BEDROOM:          ['PORCH', 'LIVING_ROOM', 'FOXY_COVE', 'RESTRICTED_UPPER'],
  FOXY_COVE:        ['BEDROOM'],
  KITCHEN:          ['FRONT_AREA', 'LIVING_ROOM', 'RESTRICTED_UPPER'],
  RESTRICTED_UPPER: ['KITCHEN', 'BEDROOM', 'RESTRICTED_LOWER'],
  RESTRICTED_LOWER: ['RESTRICTED_UPPER', 'OFFICE'],
  OFFICE:           ['RESTRICTED_LOWER', 'CHICKEN_COOP'],
  CHICKEN_COOP:     ['OFFICE']
};

const SPAWN = {
  freddy:     'FRONT_AREA',
  chica:      'FRONT_AREA',
  bonnie:     'FRONT_AREA',
  foxy:       'FOXY_COVE',
  nightguard: 'OFFICE'
};

const POWER_DURATION = 480; // 8 mins
const GAME_DURATION = 600;  // 10 mins

function killIntervals(room) {
  if (room.intervals.timer) clearInterval(room.intervals.timer);
  if (room.intervals.power) clearInterval(room.intervals.power);
  if (room.intervals.music) clearInterval(room.intervals.music);
  if (room.intervals.step)  clearInterval(room.intervals.step);
}

// ─── Socket Logic ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let playerRoomCode = null;

  socket.on('create_room', (code) => {
    if (rooms[code]) return socket.emit('error_msg', 'Room already exists!');
    rooms[code] = {
      players: {},
      gameStarted: false,
      gameState: null,
      intervals: {}
    };
    socket.emit('room_created', code);
  });

  socket.on('join_room', ({ code, name }) => {
    if (!rooms[code]) return socket.emit('error_msg', 'Room not found!');
    if (rooms[code].gameStarted) return socket.emit('error_msg', 'Game already started!');
    
    playerRoomCode = code;
    rooms[code].players[socket.id] = { id: socket.id, name, role: null, pos: null };
    socket.join(code);
    io.to(code).emit('update_players', Object.values(rooms[code].players));
  });

  socket.on('select_role', (role) => {
    const code = playerRoomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    
    // Check if role taken
    const taken = Object.values(room.players).some(p => p.role === role);
    if (taken) return socket.emit('error_msg', 'Role already taken!');

    room.players[socket.id].role = role;
    io.to(code).emit('update_players', Object.values(room.players));
  });

  socket.on('start_game', () => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room) return;

    const pArray = Object.values(room.players);
    if (pArray.length < 2) return socket.emit('error_msg', 'Need at least 2 players!');
    if (!pArray.some(p => p.role === 'nightguard')) return socket.emit('error_msg', 'Missing Night Guard!');

    room.gameStarted = true;
    room.gameState = {
      timer: GAME_DURATION,
      power: 100,
      powerOut: false,
      musicBox: 100,
      doorClosed: false,
      officeOccupied: true,
      positions: {}
    };

    pArray.forEach(p => {
      p.pos = SPAWN[p.role];
      room.gameState.positions[p.role] = p.pos;
    });

    io.to(code).emit('game_init', { players: room.players, state: room.gameState });

    // Intervals
    room.intervals.timer = setInterval(() => {
      room.gameState.timer--;
      if (room.gameState.timer <= 0) {
        killIntervals(room);
        io.to(code).emit('game_over', { winner: 'nightguard', reason: 'Survived until 6 AM!' });
      } else {
        io.to(code).emit('timer_update', room.gameState.timer);
      }
    }, 1000);

    room.intervals.power = setInterval(() => {
      if (room.gameState.powerOut) return;
      let drain = 100 / POWER_DURATION;
      if (room.gameState.doorClosed) drain *= 3;
      room.gameState.power -= drain;
      if (room.gameState.power <= 0) {
        room.gameState.power = 0; room.gameState.powerOut = true;
        room.gameState.doorClosed = false;
        io.to(code).emit('power_out');
      } else {
        io.to(code).emit('power_update', room.gameState.power);
      }
    }, 1000);

    room.intervals.music = setInterval(() => {
      room.gameState.musicBox -= 1.5;
      if (room.gameState.musicBox < 0) room.gameState.musicBox = 0;
      io.to(code).emit('music_update', room.gameState.musicBox);
    }, 1000);

    room.intervals.step = setInterval(() => {
      io.to(code).emit('step_event');
    }, 10000);
  });

  socket.on('move', (newPos) => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room || !room.gameStarted) return;
    const player = room.players[socket.id];
    
    if (!ADJACENCY[player.pos].includes(newPos)) return;

    if (newPos === 'OFFICE') {
      if (room.gameState.doorClosed) {
        return socket.emit('notif', 'Door is locked! You cannot enter.');
      }
      if (room.gameState.officeOccupied) {
        killIntervals(room);
        io.to(code).emit('game_over', { winner: 'animatronics', reason: `${player.name} caught the guard!` });
        return;
      }
    }

    player.pos = newPos;
    room.gameState.positions[player.role] = newPos;
    io.to(code).emit('update_positions', room.gameState.positions);
    io.to(code).emit('notif_all', `${player.name} moved to ${newPos.replace('_',' ')}`);
  });

  socket.on('toggle_door', () => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room || room.gameState.powerOut) return;
    room.gameState.doorClosed = !room.gameState.doorClosed;
    io.to(code).emit('door_update', room.gameState.doorClosed);
  });

  socket.on('wind_music', () => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room) return;
    room.gameState.musicBox = Math.min(100, room.gameState.musicBox + 8);
    io.to(code).emit('music_update', room.gameState.musicBox);
  });

  socket.on('brb_toggle', (isBrb) => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room) return;
    room.gameState.officeOccupied = !isBrb;
    const pName = room.players[socket.id].name;
    io.to(code).emit('notif_all', isBrb ? `${pName} left the office!` : `${pName} returned to the office.`);
  });

  socket.on('restore_power', () => {
    const code = playerRoomCode;
    const room = rooms[code];
    if (!room || !room.gameState.powerOut) return;
    const gs = room.gameState;
    gs.power = 25; gs.powerOut = false;
    room.intervals.power = setInterval(() => {
      if (!room.gameState || room.gameState.powerOut) return;
      room.gameState.power -= 100 / POWER_DURATION;
      if (room.gameState.power <= 0) {
        room.gameState.power = 0; room.gameState.powerOut = true;
        clearInterval(room.intervals.power);
        io.to(code).emit('power_out');
      } else {
        io.to(code).emit('power_update', room.gameState.power);
      }
    }, 1000);
    io.to(code).emit('power_restored', gs.power);
  });

  socket.on('disconnect', () => {
    const code = playerRoomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const player = room.players[socket.id];
    if (!player) return;
    const pName = player.name;
    const pRole = player.role;
    delete room.players[socket.id];
    if (Object.keys(room.players).length === 0) {
      killIntervals(room); delete rooms[code];
    } else {
      if (room.gameStarted) {
        io.to(code).emit('notif_all', `${pName} has disconnected.`);
        if (pRole === 'nightguard') {
          killIntervals(room);
          io.to(code).emit('game_over', { winner: 'animatronics', reason: 'Night Guard disconnected!' });
        }
      }
      io.to(code).emit('update_players', Object.values(room.players));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Server running on port ${PORT}`);
});
