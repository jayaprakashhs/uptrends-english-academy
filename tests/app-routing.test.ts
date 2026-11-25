import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAdminPageFromPath,
  getAdminPathForPage,
  getInitialPage,
  isAdminHostname,
} from '../src/lib/appRouting';

test('admin hostname opens the login route by default', () => {
  assert.equal(getInitialPage('admin.uptrendsenglishacademy.in', '/'), 'admin-login');
  assert.equal(getInitialPage('admin.uptrendsenglishacademy.in', '/admin/login'), 'admin-login');
});

test('only the exact admin hostname selects the admin experience', () => {
  assert.equal(isAdminHostname('ADMIN.UPTRENDSENGLISHACADEMY.IN'), true);
  assert.equal(isAdminHostname('not-admin.uptrendsenglishacademy.in'), false);
  assert.equal(getInitialPage('uptrendsenglishacademy.in', '/admin/login'), 'home');
});

test('admin portal routes resolve separately and unknown admin paths fail closed', () => {
  assert.equal(getAdminPageFromPath('/admin'), 'admin-portal');
  assert.equal(getAdminPageFromPath('/admin/dashboard'), 'admin-portal');
  assert.equal(getAdminPageFromPath('/unknown'), 'admin-login');
  assert.equal(getAdminPathForPage('admin-login'), '/admin/login');
  assert.equal(getAdminPathForPage('admin-portal'), '/admin');
});