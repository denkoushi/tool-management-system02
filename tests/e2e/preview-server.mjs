import httpServer from 'http-server';

const port = process.env.PORT ? Number(process.env.PORT) : 4173;
const host = process.env.HOST || '127.0.0.1';

const server = httpServer.createServer({
  root: process.cwd(),
  cache: -1,
  showDir: false,
  cors: true,
  silent: true,
});

server.listen(port, host, () => {
  console.log(`preview-server listening on http://${host}:${port}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
