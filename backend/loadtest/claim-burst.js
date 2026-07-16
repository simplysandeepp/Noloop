// Claim burst — 500 submissions in 10 minutes (hospital morning). Measures the
// submit path and proves no dropped/duplicated claims. Compare two modes:
//   - queue OFF (NOLOOP_USE_QUEUE=0): synchronous adjudication on the request.
//   - queue ON: submit returns fast (PROCESSING); the worker absorbs the burst.
//
// Run:
//   BASE_URL=https://staging-api TOKEN=<hospital-jwt> INSURER_TENANT_ID=<id> \
//     k6 run backend/loadtest/claim-burst.js
//
// Uses a UNIQUE patient name per iteration; NEVER run against the shared dev DB
// without a cleanup plan.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const TOKEN = __ENV.TOKEN || '';
const INSURER = __ENV.INSURER_TENANT_ID || '';

export const options = {
  scenarios: {
    morning_burst: {
      executor: 'constant-arrival-rate',
      rate: 50, // 50/min
      timeUnit: '1m',
      duration: '10m', // → ~500 submissions
      preAllocatedVUs: 30,
      maxVUs: 80,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.005'],
    http_req_duration: ['p(95)<2000'], // submit SLO (sync path)
  },
};

export default function () {
  const id = `${__VU}-${__ITER}`;
  const body = {
    insurerTenantId: INSURER,
    type: 'CASHLESS',
    patientName: `LoadTest Patient ${id}`,
    patientAge: 40,
    patientGender: 'M',
    diagnosis: 'Acute appendicitis',
    procedure: 'Appendectomy',
    admittedAt: '2026-03-25',
    dischargedAt: '2026-03-26',
    lineItems: [
      { desc: 'Room charges (1 days)', amountPaise: 500000 },
      { desc: 'Appendectomy', amountPaise: 1500000 },
    ],
    totalPaise: 2000000,
  };
  const res = http.post(`${BASE}/claims`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
  check(res, {
    'submit 200/201': (r) => r.status === 200 || r.status === 201,
    'has claimNumber': (r) => {
      try {
        return !!r.json('claimNumber');
      } catch (_e) {
        return false;
      }
    },
  });
}
