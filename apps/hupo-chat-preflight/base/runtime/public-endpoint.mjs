import { request as httpRequest } from 'node:http';

export class PublicEndpointDiscovery {
  #url = null;
  #active = null;
  #at = null;

  constructor({ request = httpRequest, schedule = setTimeout, cancel = clearTimeout, clock = Date.now } = {}) {
    this.clock = clock;
    this.request = request;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  refresh() {
    if (!this.#active) this.#active = this.#read().finally(() => { this.#active = null; });
    return this.#active;
  }

  #read() {
    return new Promise(resolve => {
      let outgoing;
      let incoming;
      let timer;
      let finished = false;
      const finish = (url = null) => {
        if (finished) return;
        finished = true;
        this.#url = url;
        this.#at = this.clock();
        this.cancel(timer);
        incoming?.destroy();
        outgoing?.destroy();
        resolve();
      };
      timer = this.schedule(() => finish(), 750);
      try {
        outgoing = this.request({
          protocol: 'http:', hostname: 'hupo-chat-public.hupo-chat.svc.cluster.local',
          port: 20241, method: 'GET', path: '/quicktunnel', agent: false, maxHeaderSize: 1024,
          headers: { Accept: 'application/json', 'Accept-Encoding': 'identity' }
        }, response => {
          incoming = response;
          incoming.on('error', () => finish());
          if (finished) { incoming.destroy(); return; }
          if (incoming.statusCode !== 200 || Number(incoming.headers['content-length']) > 1024 ||
            ![undefined, 'identity'].includes(incoming.headers['content-encoding'])) return finish();
          const chunks = [];
          let size = 0;
          incoming.on('data', chunk => {
            if (finished) return;
            size += chunk.length;
            if (size > 1024) return finish();
            chunks.push(chunk);
          });
          incoming.on('end', () => { finish(decodeHint(Buffer.concat(chunks).toString('utf8'))); });
          incoming.on('aborted', () => finish());
          incoming.on('close', () => finish());
        });
        outgoing.on('error', () => finish());
        outgoing.on('close', () => finish());
        outgoing.end();
      } catch { finish(); }
    });
  }

  url() {
    const age = this.#at === null ? Infinity : this.clock() - this.#at;
    return age >= 0 && age < 25000 ? this.#url : null;
  }
}

export function publicEndpointHeaders(source) {
  try {
    const value = source?.url();
    if (typeof value !== 'string' || !value.startsWith('https://') || !validHostname(value.slice(8))) return {};
    return { 'X-Hupo-Chat-Public-URL': value };
  } catch { return {}; }
}

function decodeHint(body) {
  const match = /^[\t\r\n ]*\{[\t\r\n ]*"hostname"[\t\r\n ]*:[\t\r\n ]*"([a-z0-9.-]+)"[\t\r\n ]*\}[\t\r\n ]*$/.exec(body);
  return validHostname(match?.[1]) ? 'https://' + match[1] : null;
}

function validHostname(hostname) {
  if (!hostname || hostname.length > 253 || !hostname.endsWith('.trycloudflare.com')) return false;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  return hostname.split('.').every(part => label.test(part));
}
