// Phase 2/3 — Server entry point.
// Run standalone:  node server/index.js
// Or from Electron: const { startServer, stopServer } = require('../server');

const { createApp } = require('./app');
const { runMigrations } = require('./db/migrate');

// Resolves once listening. Pass { port: 0 } to let the OS pick a free port;
// the resolved `port` is always the real bound port.
async function startServer({ port, host } = {}) {
  // Bring the local database schema up to date before serving anything.
  await runMigrations();

  const app = createApp();
  const listenPort = port !== undefined ? port : Number(process.env.PORT) || 3000;
  const listenHost = host || process.env.HOST || '127.0.0.1'; // loopback only

  return new Promise((resolve, reject) => {
    const server = app.listen(listenPort, listenHost);
    server.once('listening', () => {
      const actualPort = server.address().port;
      console.log(`Server listening on http://${listenHost}:${actualPort}`);
      resolve({ server, port: actualPort, host: listenHost });
    });
    server.once('error', reject);
  });
}

// Stops accepting connections, drops keep-alive sockets, resolves when closed.
function stopServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.close(() => resolve());
    if (server.closeAllConnections) server.closeAllConnections();
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = { startServer, stopServer };
