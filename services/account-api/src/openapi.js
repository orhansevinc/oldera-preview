export const openApiDocument = {
  openapi: '3.1.0',
  info: { title: 'OldKO Public Account API', version: '0.2.0', description: 'Public player account lifecycle and secure website-session API. This is not the admin API.' },
  paths: {
    '/healthz': { get: { summary: 'Health check', responses: { '200': { description: 'Healthy' } } } },
    '/v1/session/login': { post: { summary: 'Verify player credentials and create a secure website session cookie', responses: { '200': { description: 'Signed in' }, '401': { description: 'Invalid credentials' }, '403': { description: 'Verification required' }, '423': { description: 'Account banned' }, '429': { description: 'Brute-force protection' } } } },
    '/v1/session/current': { get: { summary: 'Return the authorized website user and their characters', responses: { '200': { description: 'Current user' }, '401': { description: 'No valid session' } } } },
    '/v1/session/logout': { post: { summary: 'Revoke the current website session', responses: { '200': { description: 'Signed out' }, '403': { description: 'Origin rejected' } } } },
    '/v1/accounts/username/availability': { get: { summary: 'Validate username and check availability', parameters: [{ name: 'username', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Availability result' }, '400': { description: 'Invalid username' } } } },
    '/v1/accounts/register': { post: { summary: 'Register a player account in the shared game account store', responses: { '201': { description: 'Account created; verification required' }, '409': { description: 'Username or email already exists' }, '429': { description: 'Rate limited' } } } },
    '/v1/accounts/access-check': { post: { summary: 'Verify credentials and return player access state without creating a web session', responses: { '200': { description: 'Access allowed' }, '401': { description: 'Invalid credentials' }, '403': { description: 'Verification required' }, '423': { description: 'Account banned' }, '429': { description: 'Brute-force protection' } } } },
    '/v1/accounts/password/change': { post: { summary: 'Change password using the current password', responses: { '200': { description: 'Password changed and existing website sessions become invalid' }, '401': { description: 'Invalid credentials' }, '429': { description: 'Brute-force protection' } } } },
    '/v1/accounts/password-reset/request': { post: { summary: 'Request password reset without account enumeration', responses: { '202': { description: 'Always accepted for syntactically valid input' }, '429': { description: 'Rate limited' } } } },
    '/v1/accounts/password-reset/confirm': { post: { summary: 'Consume reset token and set new password', responses: { '200': { description: 'Password changed' }, '400': { description: 'Invalid or expired token' } } } },
    '/v1/accounts/verification/request': { post: { summary: 'Request/resend account verification', responses: { '202': { description: 'Accepted without account enumeration' }, '429': { description: 'Rate limited' } } } },
    '/v1/accounts/verification/confirm': { post: { summary: 'Consume verification token', responses: { '200': { description: 'Account verified' }, '400': { description: 'Invalid or expired token' } } } }
  }
};
