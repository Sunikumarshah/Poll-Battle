const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket server running on ws://localhost:8080');

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Rooms structure: { [code]: { question, options, votes: {A:0,B:0}, users: Map<socketId, name>, voters: Set<name>, timerEnd, timeoutId } }
const rooms = new Map();

function broadcastToRoom(roomCode, payload) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const [sockId, socket] of room.users) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.roomCode = null;
  ws.userName = null;

  ws.on('message', (msgRaw) => {
    let msg;
    try {
      msg = JSON.parse(msgRaw);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid_json' }));
      return;
    }

    const { type, payload } = msg;

    if (type === 'create_room') {
      const name = String(payload?.name || '').trim();
      const question = String(payload?.question || 'Cats vs Dogs');
      const options = payload?.options || ['A', 'B'];

      if (!name) {
        ws.send(JSON.stringify({ type: 'error', message: 'name_required' }));
        return;
      }

      const roomCode = makeRoomCode();
      const timerSeconds = 60;
      const timerEnd = Date.now() + timerSeconds * 1000;

      const room = {
        question,
        options,
        votes: { A: 0, B: 0 },
        users: new Map(), // sockId -> ws
        voters: new Set(), // usernames who have voted
        timerEnd,
        timeoutId: null
      };

      // add user
      room.users.set(ws.id, ws);
      ws.roomCode = roomCode;
      ws.userName = name;

      // start countdown
      room.timeoutId = setTimeout(() => {
        // mark ended and broadcast
        broadcastToRoom(roomCode, { type: 'voting_ended', payload: { votes: room.votes } });
      }, timerSeconds * 1000);

      rooms.set(roomCode, room);

      ws.send(JSON.stringify({
        type: 'room_created',
        payload: { roomCode, question: room.question, options: room.options, votes: room.votes, timerEnd }
      }));

      // inform new user of join state
      broadcastToRoom(roomCode, { type: 'update', payload: { votes: room.votes, timerEnd } });

      return;
    }

    if (type === 'join_room') {
      const name = String(payload?.name || '').trim();
      const roomCode = String(payload?.roomCode || '').trim().toUpperCase();

      if (!name || !roomCode) {
        ws.send(JSON.stringify({ type: 'error', message: 'name_and_room_required' }));
        return;
      }

      const room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'room_not_found' }));
        return;
      }

      // reject duplicate name in same room
      for (const [id, socket] of room.users) {
        if (socket.userName === name) {
          ws.send(JSON.stringify({ type: 'error', message: 'name_taken' }));
          return;
        }
      }

      // attach
      room.users.set(ws.id, ws);
      ws.roomCode = roomCode;
      ws.userName = name;

      // send joined payload
      ws.send(JSON.stringify({
        type: 'joined_room',
        payload: {
          roomCode,
          question: room.question,
          options: room.options,
          votes: room.votes,
          timerEnd: room.timerEnd
        }
      }));

      // notify all users about current state
      broadcastToRoom(roomCode, { type: 'update', payload: { votes: room.votes, timerEnd: room.timerEnd } });
      return;
    }

    if (type === 'vote') {
      const choice = payload?.choice; // expected 'A' or 'B'
      const roomCode = ws.roomCode;
      const name = ws.userName;
      if (!roomCode || !name) {
        ws.send(JSON.stringify({ type: 'error', message: 'not_in_room' }));
        return;
      }
      const room = rooms.get(roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: 'room_missing' }));
        return;
      }

      // check timer
      if (Date.now() >= room.timerEnd) {
        ws.send(JSON.stringify({ type: 'error', message: 'voting_closed' }));
        return;
      }

      if (!choice || !['A','B'].includes(choice)) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid_choice' }));
        return;
      }

      // check if already voted
      if (room.voters.has(name)) {
        ws.send(JSON.stringify({ type: 'error', message: 'already_voted' }));
        return;
      }

      room.votes[choice] += 1;
      room.voters.add(name);

      // broadcast updated counts and indicate which user voted (so clients can update local state)
      broadcastToRoom(roomCode, { type: 'update', payload: { votes: room.votes, timerEnd: room.timerEnd, lastVoter: name } });
      return;
    }

    ws.send(JSON.stringify({ type: 'error', message: 'unknown_type' }));
  });

  ws.on('close', () => {
    // remove from room map
    const roomCode = ws.roomCode;
    const name = ws.userName;
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        room.users.delete(ws.id);
        // If the room is empty, clear timeout and delete room
        if (room.users.size === 0) {
          if (room.timeoutId) clearTimeout(room.timeoutId);
          rooms.delete(roomCode);
        } else {
          // notify remaining users of state
          broadcastToRoom(roomCode, { type: 'update', payload: { votes: room.votes, timerEnd: room.timerEnd } });
        }
      }
    }
  });
});
