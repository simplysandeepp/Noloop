// Login storm — 200 logins in 5 minutes (shift start). bcrypt cost 10 is
// CPU-heavy, so this is the realistic hot spot. Also exercises the /auth/login
// rate limiter (#19), so expect some 429s at high per-IP rates — that's correct.
//
// Run:
//   BASE_URL=https://staging-api LOGIN_EMAIL=<e> LOGIN_PASSWORD=<p> \
//     k6 run backend/loadtest/login-storm.js
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const EMAIL = __ENV.LOGIN_EMAIL || 'admin@noloop.in';
const PASSWORD = __ENV.LOGIN_PASSWORD || 'changeme';

export const options = {
  scenarios: {
    shift_start: {
      executor: 'constant-arrival-rate',
      rate: 40, // 40 logins/min
      timeUnit: '1m',
      duration: '5m', // → ~200 logins
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    // Login is CPU-bound (bcrypt); allow more headroom than reads.
    http_req_duration: ['p(95)<2000'],
    // 200/401 are expected outcomes; 429 = rate limiter working. Track 5xx only.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
  },
};

export default function () {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'not 5xx': (r) => r.status < 500,
    'auth outcome': (r) => [200, 401, 429].includes(r.status),
  });
}
