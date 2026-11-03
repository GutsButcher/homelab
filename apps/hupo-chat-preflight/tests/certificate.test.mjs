import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { optionalImport } from './helpers.mjs';
const certificate = await optionalImport('../base/runtime/certificate.mjs');
const rsa = rootCertificates.map(pem => new X509Certificate(pem)).find(cert =>
  cert.publicKey.asymmetricKeyType === 'rsa' && cert.publicKey.asymmetricKeyDetails.modulusLength >= 2048);
const midpoint = (Date.parse(rsa.validFrom) + Date.parse(rsa.validTo)) / 2;

test('a single PEM block rejects hidden DER, including OpenSSL auxiliary sequences', () => {
  for (const extra of [rsa.raw, Buffer.from('junk'), Buffer.from([0x30, 0x00]),
    Buffer.from([0x30, 0x02, 0x30, 0x00])]) {
    const pem = certificatePem(Buffer.concat([rsa.raw, extra]));
    assert.throws(() => certificate.validateCertificate(pem, midpoint), /CERT_INVALID/);
  }
});

test('base64 must round-trip exactly, including unused padding bits', () => {
  const payload = rsa.raw.toString('base64');
  assert.match(payload, /=$/, 'fixture must exercise padding bits');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = payload.indexOf('=') - 1;
  const changed = alphabet[alphabet.indexOf(payload[last]) | 1];
  const noncanonical = payload.slice(0, last) + changed + payload.slice(last + 1);
  assert.deepEqual(Buffer.from(noncanonical, 'base64'), rsa.raw);
  for (const body of [noncanonical, payload + '=', '=' + payload,
    payload.slice(0, 8) + '=' + payload.slice(8), payload.replace(/=+$/, '')]) {
    assert.throws(() => certificate.validateCertificate(pemEnvelope(body), midpoint), /CERT_INVALID/);
  }
});

test('only a single valid public RSA X509 is served; private or appended content is rejected', () => {
  assert.equal(typeof certificate.validateCertificate, 'function');
  const pem = rsa.toString();
  assert.equal(certificate.validateCertificate(pem, midpoint), pem.trim() + '\n');
  assert.equal(certificate.validateCertificate(pem.replace(/\n/g, '\r\n') + ' \t\r\n', midpoint), pem.trim() + '\n');
  for (const invalid of ['garbage', '-----BEGIN PRIVATE KEY-----\nCANARY\n-----END PRIVATE KEY-----',
    pem + '\n-----BEGIN RSA PRIVATE KEY-----\nCANARY\n-----END RSA PRIVATE KEY-----', pem + pem,
    'secret-canary\n' + pem, pem.replace('CERTIFICATE', 'PUBLIC KEY')]) {
    assert.throws(() => certificate.validateCertificate(invalid, midpoint), /CERT_INVALID/);
  }
  const appended = Buffer.concat([rsa.raw, Buffer.from('private-canary')]).toString('base64');
  const disguised = '-----BEGIN CERTIFICATE-----\n' + appended + '\n-----END CERTIFICATE-----';
  assert.throws(() => certificate.validateCertificate(disguised, midpoint), /CERT_INVALID/);
  assert.throws(() => certificate.validateCertificate(pem, Date.parse(rsa.validTo) + 1), /CERT_INVALID/);
  assert.throws(() => certificate.validateCertificate(pem, Date.parse(rsa.validFrom) - 1), /CERT_INVALID/);
  const ec = rootCertificates.find(pem => new X509Certificate(pem).publicKey.asymmetricKeyType === 'ec');
  assert.throws(() => certificate.validateCertificate(ec, midpoint), /CERT_INVALID/);
});

function certificatePem(der) {
  return pemEnvelope(der.toString('base64'));
}

function pemEnvelope(payload) {
  const lines = payload.match(/.{1,64}/g).join('\n');
  return '-----BEGIN CERTIFICATE-----\n' + lines + '\n-----END CERTIFICATE-----\n';
}
