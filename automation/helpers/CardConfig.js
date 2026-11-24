'use strict';

/**
 * CardConfig — single accessor for the card-user provisioning settings, read live from the
 * Java framework's property files (the config source of truth) so NO secrets are duplicated
 * into this repo. Mirrors what helpers/DataHelper.java loads.
 *
 *   config_testing.properties              → baseURL, cardServicesBaseURL, test* (country/phone/email)
 *   cardServiceConfigs_testing.properties  → loginMobileScheme*, defaultCardPasscode, NID expiry, pickupLocationId
 *   cardServiceEncryptionPublicKey.pub     → RSA public key (PEM) for the encrypted endpoints
 *
 * Override any path with env vars BF_PROPERTIES_PATH / BF_CARD_PROPERTIES_PATH / BF_CARD_PUBKEY_PATH.
 */

const { load } = require('./PropertiesReader');
const framework = require('../config/framework');
const credentials = require('../config/credentials');

// Cross-platform: resolve the Java framework's resources/environments via
// automation/config/framework.js (QA_FRAMEWORK_PATH / BF_JAVA_FRAMEWORK_DIR /
// conventional locations). Each file can also be overridden individually.
const CFG_PATH  = process.env.BF_PROPERTIES_PATH      || framework.environmentsFile('config_testing.properties');
const CARD_PATH = process.env.BF_CARD_PROPERTIES_PATH || framework.environmentsFile('cardServiceConfigs_testing.properties');
const PUB_PATH  = process.env.BF_CARD_PUBKEY_PATH     || framework.environmentsFile('cardServiceEncryptionPublicKey.pub');

const c = load(CFG_PATH);
const k = load(CARD_PATH);

module.exports = {
  // breadfast mobile (WordPress) auth API
  mobileBaseURL:       c.baseURL,                         // https://new-testing.breadfast.tech
  // card-services API (createCardUser / createPin / cards/status / user/login)
  cardServicesBaseURL: c.cardServicesBaseURL,             // https://card-panel-testing.breadfast.tech

  // random EG mobile generation (mirrors UserDataFactory)
  countryCode:   c.testCountryCode,                       // EG
  phonePrefix:   c.testMobileNumber,                      // +20
  mobileCompany: c.testMobileCompany,                     // Etisalat -> "11"
  testEmail:     c.testEmail,
  testPassword:  c.testPassword,

  // card-service scheme login (-> x-ref-token + token used as Authorization)
  schemeUser:      k.loginMobileSchemeUserName,           // agent
  schemePass:      k.loginMobileSchemePassword,
  whitelistToken:  k.cardServiceLoginWhitelistToken || '',// x-ref-token (empty in testing)

  passcode:          k.defaultCardPasscode,               // 123321
  nationalIdExpiry:  k.cardUserNationalIdExpiryDate,      // 30-12-2029
  pickupLocationId:  k.pickupLocationId,                  // 73

  // cards-pool params (a valid, available collect package comes from this API, not a DB table)
  contractNumber:    k.cardServiceContractNumber,         // 79120179259
  typeId:            k.cardServiceTypeId,                  // 7014
  productNumber:     k.cardServiceProductNumber,           // 70000471

  pubKeyPath: PUB_PATH,

  // Live card-service DB (where card-panel-testing actually writes — separate host from the
  // breadfast/OTP DB). The Java config_testing.properties points at a STALE card DB host
  // (frozen 2026-03-14), so this does NOT come from the property files. Used for teardown only;
  // OTP reads still use the default breadfast DB connection (PropertiesReader → config_testing).
  //
  // Resolved lazily through automation/config/credentials.js → cardDb.config() — env CARD_DB_* (or the
  // older BF_CARD_* names), then credentials.local.js `cardDb*`. There is deliberately NO literal
  // fallback: this file is tracked by git. Requiring this module never throws; using the card DB
  // without those values throws an error naming the missing key.
  get cardDb() { return credentials.cardDb.config(); },
};
