import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHandler } from './endpoint.mjs';
import { PublicEndpointDiscovery } from './public-endpoint.mjs';
import { ReportCache, observe } from './snapshot.mjs';
import { KubeReader, fetchAuthenticatedCertificate, readOwnDisk } from './upstream.mjs';
import { loadProducer } from './producer.mjs';

export class PreflightService {
  #timer = null;

  constructor({ plan, producerSha256, ownNode, provider = { reader: new KubeReader(), readDisk: readOwnDisk,
    readCert: fetchAuthenticatedCertificate, certificateSource: 'kubernetes-api-service-proxy-v1' },
    publicEndpoint, makeServer = createServer, schedule = setInterval, cancel = clearInterval }) {
    this.publicEndpoint = publicEndpoint;
    this.cache = new ReportCache({ plan, producerSha256, clock: provider.clock || Date.now,
      collect: (signal, deadline) => observe(plan, ownNode, provider, signal, deadline) });
    this.schedule = schedule;
    this.cancel = cancel;
    this.server = makeServer({ requestTimeout: 5000, headersTimeout: 4000, keepAliveTimeout: 1000,
      maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, createHandler(this.cache, { certificateSource: provider.certificateSource, publicEndpoint }));
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
    this.#refreshPublicEndpoint();
    this.#timer = this.schedule(() => {
      void this.cache.refresh();
      this.#refreshPublicEndpoint();
    }, 20000);
    this.server.listen(8080, '0.0.0.0');
  }

  #refreshPublicEndpoint() {
    // Optional metadata has its own deadline and never joins capacity/certificate work.
    try { void Promise.resolve(this.publicEndpoint?.refresh()).catch(() => {}); } catch {}
  }

  stop() {
    if (this.#timer !== null) this.cancel(this.#timer);
    this.#timer = null;
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}

export function isMainModule(entrypoint, moduleUrl) {
  if (!entrypoint) return false;
  try {
    // ConfigMap entry files resolve through Kubernetes' atomic symlink directory.
    return realpathSync(entrypoint) === realpathSync(fileURLToPath(moduleUrl));
  } catch { return false; }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  try {
    const { plan, producerSha256 } = await loadProducer();
    const service = new PreflightService({ plan, producerSha256, ownNode: process.env.NODE_NAME,
      publicEndpoint: new PublicEndpointDiscovery() });
    service.start();
    process.once('SIGTERM', () => { void service.stop(); });
    process.once('SIGINT', () => { void service.stop(); });
  } catch {
    process.stderr.write('PREFLIGHT_START_FAILED\n');
    process.exitCode = 1;
  }
}
