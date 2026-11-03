import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHandler } from './endpoint.mjs';
import { ReportCache, observe } from './snapshot.mjs';
import { KubeReader, fetchPublicCertificate, readOwnDisk } from './upstream.mjs';

export class PreflightService {
  #timer = null;

  constructor({ plan, ownNode, provider = { reader: new KubeReader(), readDisk: readOwnDisk, readCert: fetchPublicCertificate },
    makeServer = createServer, schedule = setInterval, cancel = clearInterval }) {
    this.cache = new ReportCache({ plan, clock: provider.clock || Date.now,
      collect: signal => observe(plan, ownNode, provider, signal) });
    this.schedule = schedule;
    this.cancel = cancel;
    this.server = makeServer({ requestTimeout: 5000, headersTimeout: 4000, keepAliveTimeout: 1000,
      maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, createHandler(this.cache));
    this.server.maxConnections = 16;
    this.server.maxRequestsPerSocket = 10;
    this.server.on('clientError', (_error, socket) => {
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    this.server.on('error', () => { process.stderr.write('PREFLIGHT_HTTP_ERROR\n'); });
  }

  start() {
    if (this.#timer !== null) return;
    void this.cache.refresh();
    this.#timer = this.schedule(() => { void this.cache.refresh(); }, 20000);
    this.server.listen(8080, '0.0.0.0');
  }

  stop() {
    if (this.#timer !== null) this.cancel(this.#timer);
    this.#timer = null;
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const plan = JSON.parse(await readFile(new URL('./plan.json', import.meta.url), 'utf8'));
    const service = new PreflightService({ plan, ownNode: process.env.NODE_NAME });
    service.start();
    process.once('SIGTERM', () => { void service.stop(); });
    process.once('SIGINT', () => { void service.stop(); });
  } catch {
    process.stderr.write('PREFLIGHT_START_FAILED\n');
    process.exitCode = 1;
  }
}
