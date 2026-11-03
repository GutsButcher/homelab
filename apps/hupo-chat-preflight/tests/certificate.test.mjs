import test from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { optionalImport } from './helpers.mjs';
const certificate = await optionalImport('../base/runtime/certificate.mjs');
const rsa = rootCertificates.map(pem => new X509Certificate(pem)).find(cert =>
  cert.publicKey.asymmetricKeyType === 'rsa' && cert.publicKey.asymmetricKeyDetails.modulusLength >= 2048);
const midpoint = (Date.parse(rsa.validFrom) + Date.parse(rsa.validTo)) / 2;

test('only a single valid public RSA X509 is served; private or appended content is rejected', () => {
  assert.equal(typeof certificate.validateCertificate, 'function');
  const pem = rsa.toString();
  assert.equal(certificate.validateCertificate(pem, midpoint), pem.trim() + '\n');
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
