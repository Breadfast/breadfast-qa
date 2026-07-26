'use strict';

/**
 * @qa/conformance — the generic Conformance Engine contract (ADR-003).
 * The capability-neutral substrate every QA capability plugs into: one Finding
 * shape, one health score, one pattern grouping, one capability descriptor.
 * Visual Testing is instance #1 (see ../../capabilities/visual/).
 */

const finding = require('./finding');
const capability = require('./capability');
const resolver = require('./resolver');
const pipeline = require('./pipeline');
const run = require('./run');
const residual = require('./residual');
const judge = require('./judge');

module.exports = { ...finding, ...capability, ...resolver, ...pipeline, ...run, ...residual, ...judge };
