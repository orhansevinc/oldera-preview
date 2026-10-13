#!/usr/bin/env node
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

const listenHost = process.env.OLDERA_GATEWAY_HOST || '127.0.0.1';
const listenPort = Number(process.env.OLDERA_GATEWAY_PORT || 15100);
const targetHost = process.env.KO_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.KO_TARGET_PORT || 16100);

if (!Number.isInteger(listenPort) || !Number.isInteger(targetPort)) {
  throw new Error('OLDERA_GATEWAY_PORT and KO_TARGET_PORT must be integers');
}

const stamp = () => new Date().toISOString();
const hexPreview = (buf, max = 32) => Buffer.from(buf).subarray(0, max).toString('hex');

const wss = new WebSocketServer({ host: listenHost, port: listenPort });

wss.on('listening', () => {
  console.log(`[gateway] ${stamp()} listening ws://${listenHost}:${listenPort} -> tcp://${targetHost}:${targetPort}`);
});

wss.on('connection', (ws, request) => {
  const peer = request.socket.remoteAddress || 'unknown';
  console.log(`[gateway] ${stamp()} browser connected peer=${peer}`);

  const pending = [];
  let tcpReady = false;
  let closed = false;
  const tcp = net.createConnection({ host: targetHost, port: targetPort });

  const closeBoth = (reason) => {
    if (closed) return;
    closed = true;
    console.log(`[gateway] ${stamp()} closing pair reason=${reason}`);
    if (!tcp.destroyed) tcp.destroy();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(); } catch {}
    }
  };

  tcp.on('connect', () => {
    tcpReady = true;
    console.log(`[gateway] ${stamp()} tcp connected ${targetHost}:${targetPort}`);
    for (const chunk of pending.splice(0)) tcp.write(chunk);
  });

  tcp.on('data', (chunk) => {
    console.log(`[gateway] ${stamp()} s2c bytes=${chunk.length} hex=${hexPreview(chunk)}`);
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
  });

  tcp.on('error', (err) => {
    console.error(`[gateway] ${stamp()} tcp error ${err.code || ''} ${err.message}`);
    closeBoth('tcp-error');
  });
  tcp.on('close', () => closeBoth('tcp-close'));

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      console.error(`[gateway] ${stamp()} rejected text WebSocket frame`);
      closeBoth('text-frame');
      return;
    }
    const chunk = Buffer.from(data);
    console.log(`[gateway] ${stamp()} c2s bytes=${chunk.length} hex=${hexPreview(chunk)}`);
    if (tcpReady) tcp.write(chunk);
    else pending.push(chunk);
  });

  ws.on('error', (err) => {
    console.error(`[gateway] ${stamp()} websocket error ${err.message}`);
    closeBoth('websocket-error');
  });
  ws.on('close', () => closeBoth('websocket-close'));
});

const shutdown = () => {
  console.log(`[gateway] ${stamp()} shutdown`);
  for (const ws of wss.clients) {
    try { ws.terminate(); } catch {}
  }
  wss.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
