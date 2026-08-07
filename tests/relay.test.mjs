import { describe, test, expect, vi, afterEach } from 'vitest';
import { sendViaHttpRelay } from '../services/notifications.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubBrevoEnv(overrides = {}) {
  vi.stubEnv('BREVO_API_KEY', 'brevo-key-test');
  vi.stubEnv('BREVO_FROM', 'agent@propmind.test');
  for (const [k, v] of Object.entries(overrides)) vi.stubEnv(k, v);
}

function stubFetchWith(status, body) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Brevo HTTP relay', () => {
  test('sends a lead email with the Brevo payload shape', async () => {
    stubBrevoEnv();
    const fetchMock = stubFetchWith(201, { messageId: 'brevo-1' });

    const result = await sendViaHttpRelay('buyer@example.com', 'New PropMind Lead: Ankit [8/10]', 'text body', '<p>html</p>');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.headers['api-key']).toBe('brevo-key-test');
    const payload = JSON.parse(opts.body);
    expect(payload.sender.email).toBe('agent@propmind.test');
    expect(payload.to).toEqual([{ email: 'buyer@example.com' }]);
    expect(payload.subject).toBe('New PropMind Lead: Ankit [8/10]');
    expect(payload.textContent).toBe('text body');
    expect(payload.htmlContent).toBe('<p>html</p>');
    expect(result).toMatchObject({ success: true, mode: 'email', to: 'buyer@example.com', messageId: 'brevo-accepted' });
  });

  test('treats 201 as success', async () => {
    stubBrevoEnv();
    const fetchMock = stubFetchWith(201, {});
    const result = await sendViaHttpRelay('buyer@example.com', 's', 't');
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns the API error message on rejection', async () => {
    stubBrevoEnv();
    stubFetchWith(400, { message: 'Sender not verified' });
    const result = await sendViaHttpRelay('buyer@example.com', 's', 't');
    expect(result).toMatchObject({ success: false, error: 'Sender not verified' });
  });

  test('requires BREVO_FROM when AGENT_EMAIL is unset', async () => {
    stubBrevoEnv({ BREVO_FROM: '', AGENT_EMAIL: '' });
    const result = await sendViaHttpRelay('buyer@example.com', 's', 't');
    expect(result.success).toBe(false);
    expect(result.error).toBe('BREVO_FROM/AGENT_EMAIL required');
  });

  test('falls through to null when no relay key is configured', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('SENDGRID_API_KEY', '');
    vi.stubEnv('RESEND_API_KEY', '');
    const result = await sendViaHttpRelay('buyer@example.com', 's', 't');
    expect(result).toBeNull();
  });
});
