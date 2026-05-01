import { startRelayServer } from './relay.js';

const secret = process.env.TETHER_RELAY_SECRET;
if (!secret) {
  console.error('TETHER_RELAY_SECRET is required');
  process.exit(1);
}

const host = process.env.TETHER_RELAY_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.TETHER_RELAY_PORT ?? '4889', 10);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('TETHER_RELAY_PORT must be a valid TCP port');
  process.exit(1);
}

const relay = await startRelayServer({ host, port, secret });
console.log(`Tether Relay: http://${host}:${port}`);

const shutdown = async () => {
  await relay.close();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});
process.once('SIGTERM', () => {
  void shutdown();
});
