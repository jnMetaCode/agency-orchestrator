import assert from 'node:assert/strict';
import { jobObservation } from '../website/src/lib/job-observation.js';

// User-visible activity is evidence-based; historical state alone cannot promise execution.
assert.equal(jobObservation({ status: 'running', activeInThisInstance: true }), 'active');
assert.equal(jobObservation({ status: 'running', activeInThisInstance: false }), 'unconfirmed');
assert.equal(jobObservation({ status: 'running' }), 'unconfirmed');
assert.equal(jobObservation({ status: 'queued', activeInThisInstance: false }), 'unconfirmed');
assert.equal(jobObservation({ status: 'waiting_input' }), 'unconfirmed');
assert.equal(jobObservation({ status: 'completed', activeInThisInstance: false }), 'recorded');
assert.equal(jobObservation({ status: 'interrupted' }), 'recorded');
assert.equal(jobObservation({ status: 'future-unknown-state' }), 'unconfirmed');
assert.equal(jobObservation({ status: 'running', activeInThisInstance: true }, true), 'unconfirmed');
assert.equal(jobObservation({ status: 'completed' }, true), 'unconfirmed');
console.log('Job activity observation: 10 cases passed');
