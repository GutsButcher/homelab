export function createHandler(cache) {
  return (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return send(request, response, 405, { error: 'METHOD_NOT_ALLOWED' }, 'application/json', { Allow: 'GET, HEAD' });
    }
    if (request.url === '/healthz') return send(request, response, 200, { healthy: true });
    if (request.url === '/report') return send(request, response, 200, cache.report());
    if (request.url === '/certificate') {
      const pem = cache.certificate();
      return pem ? send(request, response, 200, pem, 'application/x-pem-file') :
        send(request, response, 503, { error: 'CERT_UNAVAILABLE' });
    }
    return send(request, response, 404, { error: 'NOT_FOUND' });
  };
}

function send(request, response, status, value, type = 'application/json', extra = {}) {
  const body = typeof value === 'string' ? value : JSON.stringify(value) + '\n';
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...extra });
  response.end(request.method === 'HEAD' ? undefined : body);
}
