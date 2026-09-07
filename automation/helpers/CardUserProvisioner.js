'use strict';

/**
 * CardUserProvisioner — provision a BCard user without the DB bastion.
 *
 * `CardUserFactory` builds a user up to status **Registered** (send-otp → verify → register →
 * createCardUser → createPin), but it reads the registration OTP from
 * `breadfast_testing.bf_phone_otp_verification` over the SSH bastion, which is dead. The Google Chat
 * `#testing-otp` space carries the **same** registration OTPs ("Message for +20… is Your verification
 * code is: NNNN"), so this wrapper swaps the OTP source and leaves the rest of the flow untouched.
 *
 * Promoted to `automation/helpers/` on 2026-09-03 (B10-58669). It lived in that story's folder first,
 * which is gitignored — and the need is not story-specific: any story that must reach a customer-app
 * surface gated on card status needs a freshly provisioned user, and every one of them hits the same
 * dead bastion.
 *
 * WHY a Registered user matters: the customer app only shows the **pickup-location** screen during BCard
 * sign-up. An account that already holds a card (the default fixture phone `+201155558882` does) never
 * sees it — its Pay tab and More tab expose no pickup entry point at all.
 *
 * Card statuses, in order: Pending → **Registered** → Received (collected) → Linked → Active.
 *
 * Usage:
 *   const { provisionRegisteredUser } = require('./CardUserProvisioner.js');
 *   const user = await provisionRegisteredUser();
 *   // -> { phone, localPhone, searchMobile, breadfastId, nationalId, email, firstName, lastName, cardStatus }
 *   // the Pay passcode is CardConfig.passcode; the Pay dual-auth code is the phone's LAST 4 DIGITS
 */

const CardUserFactory = require('./CardUserFactory.js');
const { fetchOtp } = require('../mobile/otp_google_chat.js');

/**
 * Replace a factory instance's OTP source with the Google Chat space.
 * `fetchOtp` resolves to `{ otp, createTime, text }`; the factory expects the CODE as a string, and
 * handing it the object produces `422 … "otp": expected string, received object`.
 */
function useChatOtp(factory, { timeoutMs = 90000, lookbackMs = 120000, log = console.log } = {}) {
  factory._readOtpFromDb = async function readOtpFromChat(phone) {
    log('  reading OTP for ' + phone + ' from the Google Chat OTP space…');
    const hit = await fetchOtp(phone, { timeoutMs, notBefore: Date.now() - lookbackMs })
      .catch((e) => { log('  chat lookup failed: ' + e.message); return null; });
    const otp = hit && hit.otp ? String(hit.otp) : null;
    log('  OTP: ' + (otp || '(none)') + (hit ? ' (' + hit.createTime + ')' : ''));
    return otp;
  };
  return factory;
}

/** A brand-new card user in status **Registered**, with its status read back and asserted. */
async function provisionRegisteredUser(options = {}) {
  const factory = useChatOtp(new CardUserFactory(), options);
  const user = await factory.provision(options);
  const cardStatus = await factory.status(user.breadfastId).catch(() => 'unknown');
  if (cardStatus !== 'Registered') {
    throw new Error(`provisioned ${user.phone} but its card status is "${cardStatus}", not "Registered".`);
  }
  return { ...user, cardStatus };
}

/** A breadfast user with NO card record at all — the "non-active BCard" state. */
async function provisionUnregisteredUser(options = {}) {
  const factory = useChatOtp(new CardUserFactory(), options);
  return factory.registerOnly();
}

module.exports = { provisionRegisteredUser, provisionUnregisteredUser, useChatOtp };
