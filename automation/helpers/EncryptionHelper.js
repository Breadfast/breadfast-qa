'use strict';

/**
 * EncryptionHelper — Node port of the Java helpers/EncryptionHelper.java.
 *
 * The card-service mobile endpoints (createCardUser / createPin / cards/status) take their
 * body wrapped as { "data": "<cipher>" }, where <cipher> = Base64( RSA-OAEP encrypt(plaintext) )
 * using the server's PUBLIC key.
 *
 * Java: Cipher "RSA/ECB/OAEPWithSHA-256AndMGF1Padding", OAEPParameterSpec("SHA-256","MGF1",
 *       MGF1ParameterSpec.SHA-256, PSpecified.DEFAULT), key = X.509/SPKI public key.
 * Node equivalent: crypto.publicEncrypt with RSA_PKCS1_OAEP_PADDING + oaepHash 'sha256'
 *       (Node uses the same hash for OAEP and MGF1 — matches the Java spec).
 *
 * The public key is the same PEM file the Java framework reads:
 *   D:\projects\resources\environments\cardServiceEncryptionPublicKey.pub
 */

const crypto = require('crypto');
const fs     = require('fs');

let _cachedKey = null;
let _cachedPath = null;

/** Load (and cache) the RSA public key from a PEM (.pub) file. */
function loadPublicKey(pubPath) {
  if (_cachedKey && _cachedPath === pubPath) return _cachedKey;
  if (!fs.existsSync(pubPath)) {
    throw new Error(`EncryptionHelper: public key file not found at "${pubPath}".`);
  }
  // The .pub file is PEM ("-----BEGIN PUBLIC KEY-----"); createPublicKey accepts PEM directly.
  _cachedKey  = crypto.createPublicKey(fs.readFileSync(pubPath, 'utf8'));
  _cachedPath = pubPath;
  return _cachedKey;
}

/**
 * Encrypt a plaintext string and return Base64 ciphertext (the value for the "data" field).
 * @param {string} plaintext  the JSON body string to encrypt
 * @param {string} pubPath    path to the RSA public-key PEM file
 * @returns {string} Base64-encoded RSA-OAEP(SHA-256) ciphertext
 */
function encryptData(plaintext, pubPath) {
  const key = loadPublicKey(pubPath);
  const enc = crypto.publicEncrypt(
    { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(plaintext, 'utf8')
  );
  return enc.toString('base64');
}

module.exports = { encryptData, loadPublicKey };
