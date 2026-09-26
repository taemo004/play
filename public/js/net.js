// Peer-to-Peer-Verbindungen über WebRTC (PeerJS).
// Wer einen Raum erstellt, ist Gastgeber: In seinem Browser läuft die Raumlogik (room.js),
// alle anderen verbinden sich direkt mit ihm. Der öffentliche PeerJS-Server vermittelt nur
// den Verbindungsaufbau – die Spieldaten laufen direkt zwischen den Browsern.

import { RoomHost } from './room.js';

const PREFIX = 'sumosmash-v1-';
const TIMEOUT_MS = 12000;
const CONNECT_TIMEOUT_MS = 8000;
const HEARTBEAT_MS = 2000;
const HOST_TIMEOUT_MS = 7000;

// Optional eigener PeerJS-Server: ?peerhost=example.com&peerport=443&peerpath=/
function peerOptions() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 0 };
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = +(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = opts.port === 443;
  }
  return opts;
}

export function makeCode() {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function netError(type, msg) {
  const e = new Error(msg || type);
  e.type = type;
  return e;
}

export class Net {
  constructor(getName) {
    this.getName = getName;
    this.handlers = {};
    this.id = null;
    this.peer = null;
    this.conn = null;
    this.host = null;
    this.pending = null;
    this.code = null;
    this.watchdog = null;
    this.pulse = null;
  }

  get isHost() {
    return !!this.host;
  }

  get connected() {
    return !!(this.host || (this.conn && this.conn.open));
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(msg) {
    const h = this.handlers[msg.t];
    if (h) h(msg);
  }

  send(msg) {
    if (this.host) this.host.handle(this.id, msg);
    else if (this.conn && this.conn.open) this.conn.send(msg);
  }

  close() {
    this.closing = true;
    const { host, conn, peer } = this;
    this.host = this.conn = this.peer = null;
    clearTimeout(this.watchdog);
    clearInterval(this.pulse);
    if (host) host.destroy();
    if (conn) conn.close();
    if (peer) peer.destroy();
    this.id = null;
    this.code = null;
    this.pending = null;
    this.closing = false;
  }

  async create() {
    this.close();
    for (let i = 0; i < 5; i++) {
      try {
        return await this.startHost(makeCode());
      } catch (e) {
        this.close();
        if (e.type !== 'unavailable-id') throw e;
      }
    }
    throw netError('failed', 'Konnte keinen Raum erstellen.');
  }

  async join(code) {
    this.close();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.joinAsClient(code);
      } catch (e) {
        this.close();
        if (e.type === 'peer-unavailable') throw netError('not-found', `Raum „${code}“ wurde nicht gefunden.`);
        if ((e.type === 'timeout' || e.type === 'closed') && attempt < 1) continue;
        throw e;
      }
    }
  }

  openPeer(id) {
    return new Promise((resolve, reject) => {
      if (!window.Peer) return reject(netError('no-lib', 'PeerJS konnte nicht geladen werden.'));
      const peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
      const timer = setTimeout(() => {
        peer.destroy();
        reject(netError('timeout', 'Zeitüberschreitung beim Verbinden.'));
      }, TIMEOUT_MS);
      peer.once('open', () => {
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on('error', (err) => {
        clearTimeout(timer);
        if (!peer.open) {
          peer.destroy();
          reject(err);
        } else if (this.pending) this.pending.reject(err);
      });
    });
  }

  async startHost(code) {
    const peer = await this.openPeer(PREFIX + code);
    this.peer = peer;
    const host = new RoomHost(code);
    this.host = host;
    this.code = code;
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) peer.reconnect();
    });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const id = host.addClient((m) => conn.open && conn.send(m));
        conn.on('data', (m) => host.handle(id, m));
        conn.on('close', () => host.removeClient(id));
        conn.on('error', () => host.removeClient(id));
      });
    });
    this.id = host.addClient((m) => queueMicrotask(() => this.onMessage(m)), true);
    host.handle(this.id, { t: 'hello', name: this.getName() });
  }

  async joinAsClient(code) {
    const peer = await this.openPeer(null);
    this.peer = peer;
    this.code = code;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(netError('timeout', 'Zeitüberschreitung beim Verbinden.')), CONNECT_TIMEOUT_MS);
      this.pending = {
        resolve: () => {
          clearTimeout(timer);
          this.pending = null;
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          this.pending = null;
          reject(e);
        },
      };
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      this.conn = conn;
      conn.on('data', (m) => {
        this.armWatchdog(conn);
        this.onMessage(m);
      });
      conn.on('open', () => {
        this.armWatchdog(conn);
        clearInterval(this.pulse);
        this.pulse = setInterval(() => conn.open && conn.send({ t: 'hb' }), HEARTBEAT_MS);
      });
      conn.on('close', () => {
        if (this.conn !== conn || this.closing) return;
        if (this.pending) this.pending.reject(netError('closed', 'Verbindung getrennt.'));
        else {
          this.close();
          this.emit({ t: 'hostlost' });
        }
      });
    });
  }

  armWatchdog(conn) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      if (this.conn === conn) conn.close();
    }, HOST_TIMEOUT_MS);
  }

  onMessage(m) {
    if (!m || typeof m.t !== 'string' || m.t === 'hb') return;
    if (m.t === 'welcome') {
      this.id = m.id;
      if (!this.host) this.send({ t: 'hello', name: this.getName() });
      return;
    }
    if (this.pending) {
      if (m.t === 'error') return this.pending.reject(netError(m.code || 'error', m.msg));
      if (m.t === 'joined') this.pending.resolve();
    }
    this.emit(m);
  }
}
