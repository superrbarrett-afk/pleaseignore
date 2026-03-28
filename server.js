const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

const GAME_DURATION      = 600;  // 10 min (6 AM)
const POWER_DURATION     = 480;  // 8 min power
const MUSIC_BOX_DURATION = 300;  // 5 min music box
const STEP_MS            = 10000;// animatronics can move every 10s

// ─── Helpers ──────────────────────────────────────────────────────────────
function sanitize(room) {
  return {
    code: room.code,
    host: room.host,
    gameStarted: room.gameStarted,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [
        id,
        { name: p.name, role: p.role, socketId: p.socketId }
      ])
    )
  };
}

function positions(room) {
  const out = {};
  Object.values(room.players).forEach(p => {
    out[p.socketId] = {
      name: p.name, role: p.role,
      currentRoom: p.currentRoom, canMove: p.canMove
    };
  });
  return out;
}

function killIntervals(room) {
  Object.values(room.intervals || {}).forEach(clearInterval);
  room.intervals = {};
  room.gameStarted = false;
}

// ─── Socket Events ─────────────────────────────────────────────────────────
io.on('connection', socket => {
  let playerRoomCode = null;

  // ── Lobby ──
  socket.on('create_room', ({ name, code }) => {
    if (!code || !name) return;
    if (rooms[code]) { socket.emit('error_msg', 'Room code already taken!'); return; }
    rooms[code] = {
      code, host: socket.id,
      players: {}, gameStarted: false, gameState: null, intervals: {}
    };
    rooms[code].players[socket.id] = {
      name, role: null, currentRoom: null, socketId: socket.id, canMove: false
    };
    socket.join(code);
    playerRoomCode = code;
    socket.emit('room_created', { code });
    io.to(code).emit('room_update', sanitize(rooms[code]));
  });

  socket.on('join_room', ({ name, code }) => {
    if (!code || !name) return;
    const room = rooms[code];
    if (!room) { socket.emit('error_msg', 'Room not found!'); return; }
    if (room.gameStarted) { socket.emit('error_msg', 'Game already in progress!'); return; }
    if (Object.keys(room.players).length >= 5) { socket.emit('error_msg', 'Room is full (max 5)!'); return; }
    room.players[socket.id] = {
      name, role: null, currentRoom: null, socketId: socket.id, canMove: false
    };
    socket.join(code);
    playerRoomCode = code;
    socket.emit('room_joined', { code });
    io.to(code).emit('room_update', sanitize(room));
  });

  socket.on('select_role', ({ code, role }) => {
    const room = rooms[code];
    if (!room || !room.players[socket.id] || room.gameStarted) return;
    const taken = Object.values(room.players).some(p => p.role === role && p.socketId !== socket.id);
    if (taken) { socket.emit('error_msg', 'Role already taken!'); return; }
    room.players[socket.id].role = role;
    io.to(code).emit('room_update', sanitize(room));
  });

  socket.on('start_game', ({ code }) => {
    const room = rooms[code];
    if (!room || room.host !== socket.id || room.gameStarted) return;
    const all = Object.values(room.players);
    if (all.length < 2 || !all.every(p => p.role) || !all.some(p => p.role === 'nightguard')) {
      socket.emit('error_msg', 'Need 2+ players with roles, including a Night Guard!'); return;
    }
    all.forEach(p => { p.currentRoom = SPAWN[p.role]; p.canMove = false; });
    room.gameStarted = true;
    room.gameState = {
      power: 100, musicBox: 100, doorsLocked: false,
      foxyCanRun: false, nightguardInOffice: true, powerOut: false, gameTime: GAME_DURATION
    };
    io.to(code).emit('game_started', { players: room.players, gameState: room.gameState });

    // Power drain
    room.intervals.power = setInterval(() => {
      const gs = room.gameState;
      if (!gs || gs.powerOut) return;
      gs.power -= 100 / POWER_DURATION;
      if (gs.power <= 0) {
        gs.power = 0; gs.powerOut = true;
        clearInterval(room.intervals.power);
        io.to(code).emit('power_out');
      } else {
        io.to(code).emit('power_update', gs.power);
      }
    }, 1000);

    // Music box drain
    room.intervals.musicBox = setInterval(() => {
      const gs = room.gameState;
      if (!gs || gs.musicBox <= 0) return;
      gs.musicBox -= 100 / MUSIC_BOX_DURATION;
      if (gs.musicBox <= 0) {
        gs.musicBox = 0; gs.foxyCanRun = true;
        const foxy = Object.values(room.players).find(p => p.role === 'foxy');
        if (foxy) io.to(foxy.socketId).emit('foxy_can_run');
        io.to(code).emit('music_box_empty');
        io.to(code).emit('notif_all', '🎵 MUSIC BOX HAS RUN DOWN!');
      }
      io.to(code).emit('music_box_update', gs.musicBox);
    }, 1000);

    // 6AM timer
    room.intervals.gameTimer = setInterval(() => {
      const gs = room.gameState;
      if (!gs) return;
      gs.gameTime--;
      io.to(code).emit('timer_update', gs.gameTime);
      if (gs.gameTime <= 0) {
        killIntervals(room);
        io.to(code).emit('game_over', { winner: 'nightguard', reason: '6 AM! You survived the night!' });
      }
    }, 1000);

    // Step timer – animatronics move every 10s
    room.intervals.step = setInterval(() => {
      if (!room.gameStarted) return;
      Object.values(room.players).forEach(p => {
        if (p.role !== 'nightguard') p.canMove = true;
      });
      io.to(code).emit('step', positions(room));
    }, STEP_MS);
  });

  // ── Animatronic movement ──
  socket.on('move', ({ code, targetRoom }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || player.role === 'nightguard') return;
    if (!player.canMove) { socket.emit('error_msg', 'Wait for the STEP!'); return; }
    if (!ADJACENCY[player.currentRoom]?.includes(targetRoom)) {
      socket.emit('error_msg', 'Can\'t move there!'); return;
    }
    if (targetRoom === 'OFFICE' && room.gameState?.doorsLocked) {
      socket.emit('blocked'); return;
    }
    player.currentRoom = targetRoom;
    player.canMove = false;
    const pos = positions(room);
    io.to(code).emit('positions_update', pos);
    if (targetRoom === 'OFFICE' && room.gameState?.nightguardInOffice) {
      killIntervals(room);
      io.to(code).emit('game_over', {
        winner: 'animatronics',
        reason: `${player.name} (${player.role.toUpperCase()}) caught the Night Guard!`
      });
    }
  });

  // Foxy special rush
  socket.on('foxy_rush', ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    const player = room.players[socket.id];
    if (!player || player.role !== 'foxy' || !room.gameState?.foxyCanRun) return;
    player.currentRoom = 'RESTRICTED_LOWER';
    player.canMove = true;
    io.to(code).emit('positions_update', positions(room));
    io.to(code).emit('notif_all', '🦊 FOXY IS RUNNING DOWN THE HALL!');
    io.to(code).emit('anim_notif', '🦊 FOXY IS RUNNING DOWN THE HALL!');
  });

  // ── Night Guard controls ──
  socket.on('toggle_door', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players[socket.id]?.role !== 'nightguard') return;
    const gs = room.gameState;
    if (!gs) return;
    gs.doorsLocked = !gs.doorsLocked;
    io.to(code).emit('door_update', gs.doorsLocked);
    io.to(code).emit('anim_notif',
      gs.doorsLocked ? '🚪 The Night Guard has closed the door!' : '🚪 The Night Guard opened the door.');
  });

  socket.on('nightguard_brb', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players[socket.id]?.role !== 'nightguard') return;
    if (room.gameState) room.gameState.nightguardInOffice = false;
    socket.emit('show_brb');
    io.to(code).emit('anim_notif', '👤 The Night Guard has left the office...');
  });

  socket.on('nightguard_return', ({ code, password }) => {
    const room = rooms[code];
    if (!room || room.players[socket.id]?.role !== 'nightguard') return;
    if (password.toLowerCase().trim() === 'admin') {
      if (room.gameState) room.gameState.nightguardInOffice = true;
      socket.emit('return_to_office');
      io.to(code).emit('positions_update', positions(room));
    } else {
      socket.emit('error_msg', 'ACCESS DENIED');
    }
  });

  socket.on('wind_music_box', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players[socket.id]?.role !== 'nightguard') return;
    const gs = room.gameState;
    if (!gs) return;
    gs.musicBox = Math.min(100, gs.musicBox + (3 / MUSIC_BOX_DURATION) * 100);
    if (gs.foxyCanRun && gs.musicBox > 0) {
      gs.foxyCanRun = false;
      const foxy = Object.values(room.players).find(p => p.role === 'foxy');
      if (foxy) io.to(foxy.socketId).emit('foxy_run_revoked');
    }
    io.to(code).emit('music_box_update', gs.musicBox);
  });

  socket.on('restore_power', ({ code }) => {
    const room = rooms[code];
    if (!room || room.players[socket.id]?.role !== 'nightguard') return;
    const gs = room.gameState;
    if (!gs || !gs.powerOut) return;
    gs.power = 25; gs.powerOut = false;
    clearInterval(room.intervals.power);
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

  // ── Disconnect ──
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
      io.to(code).emit('room_update', sanitize(room));
    }
  });
});

server.listen(3000, () => {
  console.log('\n🎮 ===================================');
  console.log('   FNAF Multiplayer Server RUNNING');
  console.log('   http://localhost:3000');
  console.log('=====================================\n');
});
