import  { useEffect, useRef, useState } from 'react';

const WS_URL = 'ws://localhost:8080';

function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

export default function App(){
  const [name, setName] = useLocalStorage('poll_name', '');
  const [roomCode, setRoomCode] = useLocalStorage('poll_room', '');
  const [voteRecord, setVoteRecord] = useLocalStorage('poll_votes', {}); // {roomCode: 'A'|'B'}
  const wsRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['A','B']);
  const [votes, setVotes] = useState({A:0,B:0});
  const [remaining, setRemaining] = useState(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState(null);

  // computed
  const myVote = voteRecord[roomCode] || null;
  const votingClosed = remaining !== null && remaining <= 0;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => { setConnected(true); setStatusMsg('Connected to server'); };
    ws.onclose = () => { setConnected(false); setStatusMsg('Disconnected'); };
    ws.onerror = ()=> setError('WebSocket error');
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      const { type, payload } = msg;
      if (type === 'room_created') {
        setJoined(true);
        setRoomCode(payload.roomCode);
        setQuestion(payload.question);
        setOptions(payload.options || ['A','B']);
        setVotes(payload.votes || {A:0,B:0});
        setRemaining(Math.max(0, Math.ceil((payload.timerEnd - Date.now())/1000)));
      } else if (type === 'joined_room') {
        setJoined(true);
        setQuestion(payload.question);
        setOptions(payload.options || ['A','B']);
        setVotes(payload.votes || {A:0,B:0});
        setRemaining(Math.max(0, Math.ceil((payload.timerEnd - Date.now())/1000)));
        setRoomCode(payload.roomCode);
      } else if (type === 'update') {
        setVotes(payload.votes || votes);
        setRemaining(Math.max(0, Math.ceil((payload.timerEnd - Date.now())/1000)));
        setError(null);
      } else if (type === 'voting_ended') {
        setVotes(payload.votes || votes);
        setRemaining(0);
      } else if (type === 'error') {
        setError(payload?.message || msg.message || 'error');
      }
    };

    return () => {
      try { ws.close(); } catch{}
    };
    // eslint-disable-next-line
  }, []);

  // countdown tick locally (approx)
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) { setRemaining(0); return;}
    const t = setInterval(() => setRemaining(r => (r>0? r-1:0)), 1000);
    return () => clearInterval(t);
  }, [remaining]);

  function createRoom() {
    if (!name.trim()) { setError('Enter your name'); return; }
    const msg = { type: 'create_room', payload: { name: name.trim(), question: 'Cats vs Dogs', options: ['Cats','Dogs'] } };
    wsRef.current?.send(JSON.stringify(msg));
  }

  function joinRoom() {
    if (!name.trim() || !roomCode.trim()) { setError('Name and room code required'); return; }
    const msg = { type: 'join_room', payload: { name: name.trim(), roomCode: roomCode.trim() } };
    wsRef.current?.send(JSON.stringify(msg));
  }

  function castVote(choiceLabel) {
    // map label to 'A' or 'B' based on available options index
    if (!joined || votingClosed) return;
    if (myVote) return; // already voted locally
    const choice = (choiceLabel === options[0]) ? 'A' : 'B';
    wsRef.current?.send(JSON.stringify({ type: 'vote', payload: { choice } }));
    // optimistically mark local vote; server will reject if duplicate
    setVoteRecord(vr => ({ ...vr, [roomCode]: choice }));
  }

  function leaveRoom() {
    setJoined(false);
    setQuestion('');
    setVotes({A:0,B:0});
    setRemaining(null);
    setRoomCode('');
    // keep name persisted
  }

  return (
    <div className="container">
      <h2 className="center">Live Poll — Cats vs Dogs</h2>
      <div className="small center">Server: {connected ? 'connected' : 'disconnected'} {error && <span style={{color:'red'}}> — {error}</span>}</div>

      {!joined ? (
        <>
          <div style={{marginTop:20}}>
            <label>Your name</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Unique name (no password)" />
          </div>

          <div style={{display:'flex', gap:10, marginTop:12}}>
            <button onClick={createRoom}>Create New Poll Room</button>
            <div style={{flex:1}}>
              <label>Room code</label>
              <input value={roomCode} onChange={e=>setRoomCode(e.target.value)} placeholder="Enter room code to join" />
              <button style={{marginTop:8}} onClick={joinRoom}>Join Room</button>
            </div>
          </div>

          <div style={{marginTop:18}}>
            <div className="small">Local vote stored across refreshes using localStorage. Voting lasts 60 seconds per room.</div>
          </div>
        </>
      ) : (
        <>
          <div style={{marginTop:10}}>
            <strong>Room:</strong> {roomCode}
            <button style={{marginLeft:10}} onClick={leaveRoom}>Leave</button>
          </div>

          <h3 style={{marginTop:8}}>{question}</h3>
          <div className="small">Time remaining: {remaining !== null ? `${remaining}s` : '-'}</div>

          <div style={{marginTop:14}}>
            {options.map((opt, idx) => {
              const key = idx===0? 'A' : 'B';
              const total = votes[key] ?? 0;
              const percent = (votes.A + votes.B) > 0 ? Math.round((total / (votes.A+votes.B))*100) : 0;
              const disabled = Boolean(myVote) || votingClosed;
              return (
                <div key={key} className={`option ${disabled? 'disabled': ''}`}>
                  <div>
                    <div style={{fontWeight:600}}>{opt}</div>
                    <div className="small">{total} vote(s) • {percent}%</div>
                  </div>
                  <div>
                    <button onClick={()=>castVote(opt)} disabled={Boolean(myVote) || votingClosed}>{ myVote ? (myVote === key ? 'VOTED' : 'LOCKED') : 'Vote' }</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{marginTop:12}} className="small">
            {myVote ? <>You voted: <strong>{ myVote === 'A' ? options[0] : options[1] }</strong></> : <>You haven't voted yet.</>}
          </div>

          <div style={{marginTop:10}}>
            <strong>Current count:</strong> {votes.A} - {votes.B}
          </div>

          {votingClosed && <div style={{marginTop:12, padding:10, background:'#fff3cd', borderRadius:6}}>Voting has ended for this room.</div>}
        </>
      )}
    </div>
  );
}
