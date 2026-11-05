import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBrandedEmail } from '../email-template';

test('renders a premium branded header with the saved public logo and academy colors', () => {
  const email = renderBrandedEmail(
    {
      title: 'Application Received',
      greeting: 'Taylor Student',
      paragraphs: ['Your application is ready for review.'],
      status: 'Awaiting review',
      details: [{ label: 'Application Reference', value: 'UEA-APP-2026-0001' }],
    },
    {
      academyName: 'Uptrend Academy',
      logoUrl: 'branding/main-logo.png',
      primaryGreen: '#14532d',
      primaryOrange: '#ea580c',
      publicAssetBaseUrl: 'https://assets.example',
    },
  );

  assert.match(email.html, /src="https:\/\/assets\.example\/branding\/main-logo\.png"/);
  assert.match(email.html, /alt="Uptrend Academy logo"/);
  assert.match(email.html, /align="center"/);
  assert.match(email.html, /width="176"[^>]+height:auto/);
  assert.match(email.html, /<h1[^>]*>Application Received<\/h1>/);
  assert.match(email.html, /background-color:#14532d/);
  assert.match(email.html, /border-bottom:4px solid #ea580c/);
  assert.match(email.html, /ACADEMY NOTIFICATION/);
  assert.match(email.html, /border-radius:10px/);
  assert.match(email.html, /STATUS&nbsp;&nbsp;<\/strong>Awaiting review/);
  assert.match(email.html, /Application Reference/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in"/);
  assert.match(email.html, /Visit the academy website/);
  assert.match(email.html, /class="detail-label"/);
  assert.match(email.html, /max-width:620px/);
  assert.match(email.text, /Application Received/);
  assert.match(email.text, /Status: Awaiting review/);
  assert.match(email.text, /Application Reference: UEA-APP-2026-0001/);
  assert.match(email.text, /https:\/\/uptrendsenglishacademy\.in/);
  assert.match(email.text, /Davangere, Karnataka, India/);
});

test('uses the dynamic academy name in the branded footer and meaningful text alternative', () => {
  const email = renderBrandedEmail({ title: 'Application Received' });

  assert.match(email.html, /Uptrend&#39;s English Academy/);
  assert.match(email.html, /Warm regards/);
  assert.match(email.html, /This is an official notification/);
  assert.doesNotMatch(email.html, /bimi-logo\.svg/);
  assert.doesNotMatch(email.html, /Spoken English \| Grammar \| Kids English/);
  assert.match(email.html, /Davangere, Karnataka/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in"/);
  assert.match(email.text, /Visit the academy: https:\/\/uptrendsenglishacademy\.in/);
  assert.match(email.text, /Uptrend's English Academy/);
});

test('falls back to the dynamic academy name instead of a hardcoded logo when the logo is missing or unsafe', () => {
  for (const logoUrl of [null, 'http://assets.example/logo.png', 'https://private.r2.cloudflarestorage.com/logo.png']) {
    const email = renderBrandedEmail(
      { title: 'New Request' },
      { academyName: 'Configured Academy', logoUrl },
    );

    assert.match(email.html, /Configured Academy/);
    assert.doesNotMatch(email.html, /src="http:\/\/assets\.example\/logo\.png"/);
    assert.doesNotMatch(email.html, /<img[^>]+src=/);
  }
});

test('renders status indicators using the configured brand palette', () => {
  const approved = renderBrandedEmail({ title: 'Approved', status: 'Approved' }, {
    primaryGreen: '#176b48',
    primaryOrange: '#f57400',
  });
  const pending = renderBrandedEmail({ title: 'Request Received', status: 'Pending' }, {
    primaryGreen: '#176b48',
    primaryOrange: '#f57400',
  });

  assert.match(approved.html, /background-color:#ecfdf5/);
  assert.match(approved.html, /color:#176b48/);
  assert.match(pending.html, /background-color:#fff7ed/);
  assert.match(pending.html, /color:#f57400/);
});

test('escapes dynamic email content and emits a plain-text alternative', () => {
  const email = renderBrandedEmail({
    title: '<script>alert(1)</script>',
    greeting: 'A <Student> & "Friend"',
    paragraphs: ['Please review <b>this</b> application.'],
    details: [{ label: 'Name', value: '<img src=x onerror=alert(1)>' }],
  });

  assert.doesNotMatch(email.html, /<script>|<img src=x/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(email.html, /A &lt;Student&gt; &amp; &quot;Friend&quot;/);
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(email.text, /Name: <img src=x onerror=alert\(1\)>/);
});

test('does not expose credentials or signed query strings in logo URLs', () => {
  for (const logoUrl of [
    'https://user:password@assets.example/logo.png',
    'https://assets.example/logo.png?token=private',
  ]) {
    const email = renderBrandedEmail(
      { title: 'New Request' },
      { logoUrl },
    );
    assert.doesNotMatch(email.html, /src="[^"]*(?:assets\.example\/logo\.png|token=private)/);
    assert.doesNotMatch(email.html, /bimi-logo\.svg/);
  }
});
