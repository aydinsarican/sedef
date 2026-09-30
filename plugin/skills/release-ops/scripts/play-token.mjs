#!/usr/bin/env node
// Prints a short-lived OAuth access token for the Google Play Developer API.
// The service account comes from $GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (a file path, or the JSON itself);
// the private key stays inside this process — only the 1-hour token is printed.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const src = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
if (!src) {
  console.error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not set for this stage');
  process.exit(2);
}
const sa = JSON.parse(src.trim().startsWith('{') ? src : readFileSync(src, 'utf8'));
const now = Math.floor(Date.now() / 1000);
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`;
const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.access_token) {
  console.error(`token request failed: HTTP ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
  process.exit(1);
}
process.stdout.write(body.access_token);
