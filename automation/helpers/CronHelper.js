'use strict';

/**
 * CronHelper — triggers the card-backend cashback cron on demand (step 3).
 *
 *   GET  {cardBackendBaseURL}/test?cronJobType=cashback
 *
 * Uses Playwright's APIRequestContext when provided (consistent with ApiHelper),
 * else falls back to Node https. Returns { status, body }.
 */

const https  = require('https');
const http   = require('http');
const config = require('./ConfigReader');

const CRON_PATH = '/test';

class CronHelper {
  /**
   * @param {import('@playwright/test').APIRequestContext} [request] optional Playwright request fixture
   * @param {string} [jobType='cashback']
   */
  static async triggerCashbackCron(request, jobType = 'cashback') {
    const url = `${config.getCardBackendBaseURL()}${CRON_PATH}?cronJobType=${encodeURIComponent(jobType)}`;

    if (request) {
      const resp = await request.get(url, { timeout: 120_000 });
      return { status: resp.status(), body: await resp.text().catch(() => '') };
    }
    return CronHelper._nodeGet(url);
  }

  static _nodeGet(url) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
  }
}

module.exports = CronHelper;
