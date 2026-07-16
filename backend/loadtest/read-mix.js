// Steady-state read mix — the everyday traffic: claim list, claim detail,
// admin stats, and public /track. Validates the read SLO (p95 < 500ms).
//
// Run:
//   BASE_URL=https://staging-api TOKEN=<jwt> CLAIM_ID=<id> CLAIM_NUMBER=<n> \
//     k6 run backend/loadtest/read-mix.js
//
// NEVER point this at prod or the shared dev DB.
import http from 'k6/http';
import { check, group, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.TOKEN || '';
const CLAIM_ID = __ENV.CLAIM_ID || '';
const CLAIM_NUMBER = __ENV.CLAIM_NUMBER || '';

export const options = {
  stages: [
    { duration: '1m', target: 30 }, // ramp
    { duration: '3m', target: 30 }, // steady
    { duration: '30s', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.005'], // < 0.5% errors
    http_req_duration: ['p(95)<500'], // read SLO
  },
};

const authHeaders = { headers: { Authorization: `Bearer ${TOKEN}` } };

export default function () {
  group('claim list', () => {
    const r = http.get(`${BASE}/claims`, authHeaders);
    check(r, { 'list 200': (res) => res.status === 200 });
  });

  if (CLAIM_ID) {
    group('claim detail', () => {
      const r = http.get(`${BASE}/claims/${CLAIM_ID}`, authHeaders);
      check(r, { 'detail 200': (res) => res.status === 200 });
    });
  }

  group('admin stats', () => {
    const r = http.get(`${BASE}/admin/stats`, authHeaders);
    check(r, { 'stats ok': (res) => res.status === 200 || res.status === 403 });
  });

  if (CLAIM_NUMBER) {
    group('public track', () => {
      const r = http.get(`${BASE}/track/${CLAIM_NUMBER}`);
      check(r, { 'track 200': (res) => res.status === 200 });
    });
  }

  sleep(1);
}
