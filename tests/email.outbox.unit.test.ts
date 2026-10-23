import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEmailTemplate } from '../src/email/templates.ts';
import { getMailMode, isMailDryRun } from '../src/email/config.ts';

describe('email templates & config', () => {
  it('renders password reset with link and no secrets', () => {
    const mail = renderEmailTemplate('password_reset', {
      name: 'Babar',
      link: 'http://127.0.0.1:3000/?resetToken=abc',
    });
    assert.match(mail.subject, /reset/i);
    assert.match(mail.html, /resetToken=abc/);
    assert.doesNotMatch(mail.html, /password123|JWT|Bearer/i);
    assert.match(mail.text, /Babar/);
  });

  it('defaults to console/dry-run friendly mode in test', () => {
    assert.ok(['console', 'smtp', 'disabled'].includes(getMailMode()));
    assert.equal(isMailDryRun(), true);
  });
});
