import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBrandedEmail } from '../email-template';

test('renders the reference header, fixed navy and orange palette, and dynamic notification content', () => {
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
      primaryGreen: '#16a34a',
      primaryOrange: '#16a34a',
      publicAssetBaseUrl: 'https://assets.example',
    },
  );

  assert.match(email.html, /src="https:\/\/assets\.example\/branding\/main-logo\.png"/);
  assert.match(email.html, /alt="Uptrend Academy official logo"/);
  assert.match(email.html, /align="center"/);
  assert.match(email.html, /width="184"[^>]+height:auto/);
  assert.match(email.html, /email-header-waves\.png/);
  assert.match(email.html, /DAVANGERE - KARNATAKA/);
  assert.match(email.html, /color:#123B78/);
  assert.match(email.html, /#EAF3FF/);
  assert.match(email.html, /#FF6B00/);
  assert.doesNotMatch(email.html, /background-color:#(?:14532d|16a34a|ecfdf5)/i);
  assert.match(email.html, /<h1[^>]*>Application Received<\/h1>/);
  assert.match(email.html, /ACADEMY NOTIFICATION/);
  assert.match(email.html, /border-radius:10px/);
  assert.match(email.html, /STATUS&nbsp;&nbsp;<\/strong>Awaiting review/);
  assert.match(email.html, /background-color:#FFF3E8/);
  assert.match(email.html, /Application Reference/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in"/);
  assert.match(email.html, /class="detail-label"/);
  assert.match(email.html, /max-width:620px/);
  assert.match(email.text, /Application Received/);
  assert.match(email.text, /Status: Awaiting review/);
  assert.match(email.text, /Application Reference: UEA-APP-2026-0001/);
  assert.match(email.text, /https:\/\/uptrendsenglishacademy\.in/);
  assert.match(email.text, /Davangere, Karnataka/);
});

test('renders the compact branded footer with contact links, slogan, copyright, and disclaimer', () => {
  const email = renderBrandedEmail({ title: 'Application Received' });

  assert.match(email.html, /Uptrend&#39;s English Academy/);
  assert.match(email.html, /Warm regards/);
  assert.match(email.html, /border-top:3px solid #123B78/);
  assert.match(email.html, /background-color:#F4F7FC/);
  assert.match(email.html, /Learn English for a Brighter Tomorrow\.\.\./);
  assert.match(email.html, /Davangere, Karnataka/);
  assert.match(email.html, /href="mailto:uptrendsinstitute@gmail\.com"/);
  assert.match(email.html, /href="tel:\+919008000211"/);
  assert.match(email.html, /\+91 9008000211/);
  assert.match(email.html, /Copyright &copy; \d{4} Uptrend&#39;s English Academy/);
  assert.match(email.html, /This is an automated email\. Please do not reply directly to this message\./);
  assert.doesNotMatch(email.html, /bimi-logo\.svg/);
  assert.doesNotMatch(email.html, /Spoken English \| Grammar \| Kids English/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in"/);
  assert.match(email.text, /Visit the academy: https:\/\/uptrendsenglishacademy\.in/);
  assert.match(email.text, /Email: uptrendsinstitute@gmail\.com/);
  assert.match(email.text, /Phone: \+91 9008000211/);
  assert.match(email.text, /Uptrend's English Academy/);
  assert.match(email.text, /automated email/);
});

test('falls back to the existing official logo when the configured logo is missing or unsafe', () => {
  for (const logoUrl of [null, 'http://assets.example/logo.png', 'https://private.r2.cloudflarestorage.com/logo.png']) {
    const email = renderBrandedEmail(
      { title: 'New Request' },
      { academyName: 'Configured Academy', logoUrl },
    );

    assert.match(email.html, /Configured Academy/);
    assert.doesNotMatch(email.html, /src="http:\/\/assets\.example\/logo\.png"/);
    assert.match(email.html, /src="https:\/\/gpnfznwqwaokfzmozpxo\.supabase\.co\/storage\/v1\/object\/public\/Uptrend&#39;s%20English%20Academy-photos\/main_logo\/UEA_main_02\.png"/);
  }
});

test('renders status indicators using the configured brand palette', () => {
  const approved = renderBrandedEmail({ title: 'Approved', status: 'Approved' });
  const pending = renderBrandedEmail({ title: 'Request Received', status: 'Pending' });

  assert.match(approved.html, /background-color:#EAF3FF/);
  assert.match(approved.html, /color:#123B78/);
  assert.match(pending.html, /background-color:#FFF3E8/);
  assert.match(pending.html, /color:#FF6B00/);
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
