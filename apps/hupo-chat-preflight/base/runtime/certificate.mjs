import { X509Certificate } from 'node:crypto';

export function validateCertificate(pem, now = Date.now()) {
  try {
    if (typeof pem !== 'string' || pem.length > 32768) throw new Error();
    const match = /^-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE-----\s*$/.exec(pem);
    if (!match) throw new Error();
    const payload = match[1].replace(/[\r\n]/g, '');
    const der = Buffer.from(payload, 'base64');
    if (der.toString('base64') !== payload) throw new Error();
    const cert = new X509Certificate(pem);
    if (!der.equals(cert.raw)) throw new Error();
    const key = cert.publicKey;
    const bits = key.asymmetricKeyDetails?.modulusLength;
    const exponent = key.asymmetricKeyDetails?.publicExponent;
    if (key.asymmetricKeyType !== 'rsa' || bits < 2048 || bits > 8192 || exponent < 65537n ||
        !Number.isFinite(now) || !(Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo))) throw new Error();
    return cert.toString().trim() + '\n';
  } catch { throw new Error('CERT_INVALID'); }
}
