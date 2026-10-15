'use strict';

const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');
const { acceptKey, encodeFrame, closePayload, FrameParser } = require('./ws');

function makeLogger(level = 'info', sink = console) {
  const ranks = { error: 0, warn: 1, info: 2, debug: 3 };
  const threshold = ranks[level] ?? ranks.info;
  const emit = (name, fields) => {
    if ((ranks[name] ?? 99) > threshold) return;
    const entry = { ts: new Date().toISOString(), level: name, ...fields };
    (sink[name] || sink.log).call(sink, JSON.stringify(entry));
  };
  return { error: (f) => emit('error', f), warn: (f) => emit('warn', f), info: (f) => emit('info', f), debug: (f) => emit('debug', f) };
}

function exactAllowed(value, allowed) {
  if (!allowed.length) return true;
  return allowed.includes(value);
}

function normalizedHost(req, trustProxy) {
  const raw = trustProxy ? (req.headers['x-forwarded-host'] || req.headers.host || '') : (req.headers.host || '');
  return String(raw).split(',')[0].trim().toLowerCase();
}

function decodeCloseFrame(payload) {
  const p = Buffer.from(payload || []);
  if (p.length < 2) return { code: 1000, reason: '' };
  return { code: p.readUInt16BE(0), reason: p.subarray(2).toString('utf8').slice(0, 123) };
}

function createGateway(config, options = {}) {
  const logger = options.logger || makeLogger(config.logLevel);
  const metrics = { startedAt: Date.now(), active: 0, accepted: 0, rejected: 0, tcpConnectFailures: 0 };
  let nextId = 1;

  const server = http.createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path === config.healthPath) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, mode: config.mode, activeConnections: metrics.active, uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  server.on('upgrade', (req, wsSocket, head) => {
    const connectionId = nextId++;
    const reject = (status, reason) => {
      metrics.rejected++;
      logger.warn({ event: 'ws_rejected', connectionId, status, reason });
      wsSocket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    };

    let path;
    try { path = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { return reject(400, 'Bad Request'); }
    if (path !== config.wsPath) return reject(404, 'Not Found');
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return reject(400, 'Bad Request');
    if (!String(req.headers.connection || '').toLowerCase().split(',').map((v) => v.trim()).includes('upgrade')) return reject(400, 'Bad Request');
    if (req.headers['sec-websocket-version'] !== '13') return reject(426, 'Upgrade Required');
    const clientKey = req.headers['sec-websocket-key'];
    if (!clientKey || Buffer.from(String(clientKey), 'base64').length !== 16) return reject(400, 'Bad Request');

    const origin = String(req.headers.origin || '');
    if (config.requireOrigin && !origin) return reject(403, 'Forbidden');
    if (origin && !exactAllowed(origin, config.allowedOrigins)) return reject(403, 'Forbidden');
    const host = normalizedHost(req, config.trustProxy);
    if (!exactAllowed(host, config.allowedHosts.map((h) => h.toLowerCase()))) return reject(403, 'Forbidden');

    const tcp = net.createConnection({ host: config.targetHost, port: config.targetPort });
    let upgraded = false;
    let closed = false;
    let awaitingPong = false;
    let pongDeadline = null;
    let idleTimer = null;
    let pingTimer = null;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => closeBoth('idle_timeout', 1001, 'idle_timeout'), config.idleTimeoutMs);
      idleTimer.unref?.();
    };
    const cleanup = () => {
      clearTimeout(idleTimer);
      clearTimeout(pongDeadline);
      clearInterval(pingTimer);
      if (upgraded) metrics.active = Math.max(0, metrics.active - 1);
      upgraded = false;
    };
    const closeBoth = (event, code = 1000, reason = '') => {
      if (closed) return;
      closed = true;
      const closeReason = String(reason || '').slice(0, 123);
      logger.info({ event, connectionId, closeCode: code, closeReason });
      if (upgraded && !wsSocket.destroyed) wsSocket.write(encodeFrame(0x8, closePayload(code, closeReason)));
      wsSocket.end();
      tcp.destroy();
      cleanup();
    };

    const connectTimer = setTimeout(() => {
      metrics.tcpConnectFailures++;
      if (!upgraded) reject(502, 'Bad Gateway');
      tcp.destroy();
    }, config.connectTimeoutMs);
    connectTimer.unref?.();

    const parser = new FrameParser({
      maxMessageBytes: config.maxMessageBytes,
      onBinary(payload) {
        touch();
        if (tcp.destroyed) return;
        if (tcp.writableLength + payload.length > config.maxBufferedBytes) return closeBoth('buffer_limit', 1009, 'buffer_limit');
        if (!tcp.write(payload)) wsSocket.pause();
      },
      onPing(payload) {
        touch();
        if (!wsSocket.destroyed) wsSocket.write(encodeFrame(0xA, payload));
      },
      onPong() {
        touch();
        awaitingPong = false;
        clearTimeout(pongDeadline);
      },
      onClose(payload) {
        const { code, reason } = decodeCloseFrame(payload);
        closeBoth('client_close', code, reason);
      },
      onProtocolError(code, reason) { closeBoth('protocol_error', code, reason); }
    });

    tcp.on('connect', () => {
      clearTimeout(connectTimer);
      if (closed) return;
      const response = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(String(clientKey))}`,
        '\r\n'
      ].join('\r\n');
      wsSocket.write(response);
      upgraded = true;
      metrics.active++;
      metrics.accepted++;
      logger.info({ event: 'connected', connectionId, mode: config.mode, target: `${config.targetHost}:${config.targetPort}` });
      touch();
      if (head?.length) parser.push(head);
      pingTimer = setInterval(() => {
        if (closed || wsSocket.destroyed) return;
        if (awaitingPong) return;
        awaitingPong = true;
        wsSocket.write(encodeFrame(0x9));
        pongDeadline = setTimeout(() => closeBoth('pong_timeout', 1001, 'pong_timeout'), config.pongTimeoutMs);
        pongDeadline.unref?.();
      }, config.pingIntervalMs);
      pingTimer.unref?.();
    });

    tcp.on('data', (chunk) => {
      touch();
      if (!upgraded || closed || wsSocket.destroyed) return;
      const frame = encodeFrame(0x2, chunk);
      if (wsSocket.writableLength + frame.length > config.maxBufferedBytes) return closeBoth('buffer_limit', 1009, 'buffer_limit');
      if (!wsSocket.write(frame)) tcp.pause();
    });
    tcp.on('drain', () => wsSocket.resume());
    wsSocket.on('drain', () => tcp.resume());
    wsSocket.on('data', (chunk) => { if (upgraded && !closed) parser.push(chunk); });

    tcp.on('error', (err) => {
      clearTimeout(connectTimer);
      if (!upgraded) {
        metrics.tcpConnectFailures++;
        return reject(502, 'Bad Gateway');
      }
      const code = err.code || 'ERR';
      logger.warn({ event: 'tcp_error', connectionId, code });
      closeBoth('tcp_error', 1011, `upstream_tcp_error:${code}`);
    });
    wsSocket.on('error', (err) => {
      const code = err.code || 'ERR';
      logger.warn({ event: 'ws_socket_error', connectionId, code });
      closeBoth('ws_socket_error', 1011, `gateway_socket_error:${code}`);
    });
    tcp.on('end', () => closeBoth('tcp_end', 1011, 'upstream_tcp_end'));
    tcp.on('close', () => { if (!closed && upgraded) closeBoth('tcp_close', 1011, 'upstream_tcp_close'); });
    wsSocket.on('end', () => closeBoth('client_end', 1000, 'client_end'));
    wsSocket.on('close', () => { if (!closed) closeBoth('client_close', 1000, 'client_close'); });
  });

  return {
    server,
    metrics,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.listenPort, config.listenHost, () => {
          server.off('error', reject);
          const address = server.address();
          logger.info({ event: 'listening', mode: config.mode, host: config.listenHost, port: address.port, wsPath: config.wsPath, healthPath: config.healthPath });
          resolve(address);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  };
}

module.exports = { createGateway, makeLogger, decodeCloseFrame };