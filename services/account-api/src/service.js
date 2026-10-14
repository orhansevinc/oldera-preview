import { AppError, badRequest, conflict, forbidden, locked, unauthorized } from './errors.js';
import { isGameCompatiblePassword, normalizeEmail, normalizeUsername, requireToken, validatePassword } from './validation.js';
import { digestToken, newId, newOpaqueToken, ScryptPasswordHasher } from './security.js';
import { SecurityGate } from './rate-limit.js';

const RESET_TTL_MS = 30 * 60_000;
const VERIFY_TTL_MS = 24 * 60 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

function activeBan(account, now) {
  if (!account.ban?.active) return null;
  if (account.ban.until && account.ban.until <= now) return null;
  return {
    code: account.ban.code || 'ACCOUNT_BANNED',
    until: account.ban.until || null,
    permanent: !account.ban.until
  };
}

function publicAccount(account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    verified: Boolean(account.verifiedAt),
    createdAt: account.createdAt ?? null,
    lastLoginAt: account.lastLoginAt ?? null,
    status: account.status || 'active'
  };
}

function exactPresentedPassword(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= 512 ? value : null;
}

export class AccountService {
  constructor({ repository, delivery, audit, hasher = new ScryptPasswordHasher(), securityGate = new SecurityGate(), clock = () => Date.now() }) {
    this.repository = repository;
    this.delivery = delivery;
    this.audit = audit;
    this.hasher = hasher;
    this.securityGate = securityGate;
    this.clock = clock;
  }

  async usernameAvailability(rawUsername, context = { ip: 'unknown' }) {
    const now = this.clock();
    await this.securityGate.assertRate(`username-availability:ip:${context.ip}`, { limit: 30, windowMs: 60_000 }, now);
    const { username, canonical } = normalizeUsername(rawUsername);
    const exists = await this.repository.findByUsernameCanonical(canonical);
    return { username, available: !exists };
  }

  async register(input, context) {
    const now = this.clock();
    const { username, canonical } = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    validatePassword(input.password);
    await this.securityGate.assertRate(`register:ip:${context.ip}`, { limit: 5, windowMs: 60 * 60_000 }, now);

    if (await this.repository.findByUsernameCanonical(canonical)) throw conflict('USERNAME_TAKEN', 'Username is already in use');
    if (await this.repository.findByEmail(email)) throw conflict('EMAIL_TAKEN', 'Email is already in use');

    const account = {
      id: newId(), username, usernameCanonical: canonical, email,
      passwordHash: await this.hasher.hash(input.password), verifiedAt: null, passwordVersion: 1,
      ban: { active: false, code: null, until: null }, status: 'active',
      createdAt: now, updatedAt: now, lastLoginAt: null
    };
    let stored;
    try { stored = await this.repository.createAccount(account); }
    catch (error) {
      if (error?.code === 'USERNAME_TAKEN') throw conflict('USERNAME_TAKEN', 'Username is already in use');
      if (error?.code === 'EMAIL_TAKEN') throw conflict('EMAIL_TAKEN', 'Email is already in use');
      throw error;
    }
    this.audit.emit({ event: 'account_registered', accountId: stored.id, requestId: context.requestId, ip: context.ip });
    await this.#issueVerification(stored, context, now);
    return { id: stored.id, username: stored.username, verificationRequired: true };
  }

  async accessCheck(input, context) {
    const { account, credentialUpgradeRequired } = await this.#authenticate({ identifier: input.username, password: input.password }, context);
    if (credentialUpgradeRequired) {
      throw forbidden('CREDENTIAL_UPGRADE_REQUIRED', 'Password must be changed to the KO1298-compatible credential policy before game login');
    }
    return { accountId: account.id, username: account.username, access: 'allowed', passwordVersion: account.passwordVersion };
  }

  async login(input, context) {
    const now = this.clock();
    const { account, credentialUpgradeRequired } = await this.#authenticate(input, context);
    const token = newOpaqueToken();
    const digest = digestToken(token);
    const expiresAt = now + SESSION_TTL_MS;
    await this.repository.createSession({
      id: newId(), accountId: account.id, digest, passwordVersion: account.passwordVersion,
      sourceIp: context.ip, userAgent: context.userAgent || null, createdAt: now, expiresAt,
      revokedAt: null, lastSeenAt: now
    });
    await this.repository.updateAccount(account.id, { lastLoginAt: now, updatedAt: now });
    this.audit.emit({ event: 'web_session_created', accountId: account.id, requestId: context.requestId, ip: context.ip, credentialUpgradeRequired });
    return { token, expiresAt, user: publicAccount({ ...account, lastLoginAt: now }), credentialUpgradeRequired };
  }

  async currentUser(token, context) {
    const now = this.clock();
    if (!token) throw unauthorized();
    const digest = digestToken(requireToken(token));
    const session = await this.repository.findSessionByDigest(digest, now);
    if (!session) throw unauthorized();
    const account = await this.repository.findById(session.accountId);
    if (!account) {
      await this.repository.revokeSessionByDigest(digest, now);
      throw unauthorized();
    }
    if (account.passwordVersion !== session.passwordVersion) {
      await this.repository.revokeSessionByDigest(digest, now);
      throw unauthorized();
    }
    const ban = activeBan(account, now);
    if (ban) {
      await this.repository.revokeSessionByDigest(digest, now);
      throw locked('ACCOUNT_BANNED', 'Account access is suspended', ban);
    }
    if (!account.verifiedAt) {
      await this.repository.revokeSessionByDigest(digest, now);
      throw forbidden('ACCOUNT_UNVERIFIED', 'Account verification is required');
    }
    await this.repository.touchSession(digest, now);
    const characters = await this.repository.listCharactersByAccount(account.id);
    return { user: publicAccount(account), characters };
  }

  async logout(token, context) {
    if (!token) return { signedOut: true };
    const now = this.clock();
    const digest = digestToken(token);
    const session = await this.repository.findSessionByDigest(digest, now);
    await this.repository.revokeSessionByDigest(digest, now);
    if (session) this.audit.emit({ event: 'web_session_revoked', accountId: session.accountId, requestId: context.requestId, ip: context.ip });
    return { signedOut: true };
  }

  async changePassword(input, context) {
    const now = this.clock();
    const { canonical } = normalizeUsername(input.username);
    await this.securityGate.assertCredentialAllowed(context.ip, canonical, now);
    validatePassword(input.newPassword);
    const currentPassword = exactPresentedPassword(input.currentPassword);
    const account = await this.repository.findByUsernameCanonical(canonical);
    if (!currentPassword || !account || !(await this.hasher.verify(currentPassword, account.passwordHash))) {
      await this.securityGate.recordCredentialFailure(context.ip, canonical, now);
      this.audit.emit({ event: 'password_change_failed', usernameCanonical: canonical, requestId: context.requestId, ip: context.ip });
      throw unauthorized();
    }
    await this.securityGate.clearCredentialFailures(context.ip, canonical);
    if (await this.hasher.verify(input.newPassword, account.passwordHash)) throw new AppError(400, 'PASSWORD_REUSE', 'New password must be different');
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.repository.updateAccount(account.id, { passwordHash, passwordVersion: account.passwordVersion + 1, updatedAt: now });
    this.audit.emit({ event: 'password_changed', accountId: account.id, requestId: context.requestId, ip: context.ip });
    return { changed: true };
  }

  async requestPasswordReset(input, context) {
    const now = this.clock();
    await this.securityGate.assertRate(`reset:ip:${context.ip}`, { limit: 5, windowMs: 15 * 60_000 }, now);
    const account = await this.#findAccountSelector(input);
    if (account) {
      const token = newOpaqueToken();
      await this.repository.createActionToken({ id: newId(), kind: 'password_reset', accountId: account.id, digest: digestToken(token), expiresAt: now + RESET_TTL_MS, consumedAt: null, createdAt: now });
      try {
        const accepted = await this.delivery.sendPasswordReset({ accountId: account.id, email: account.email, token, expiresAt: now + RESET_TTL_MS });
        if (accepted?.accepted) this.audit.emit({ event: 'delivery_provider_accepted', kind: 'password_reset', accountId: account.id, requestId: context.requestId, provider: accepted.provider, providerMessageId: accepted.providerMessageId });
      } catch (error) { this.audit.emit({ event: 'delivery_failed', kind: 'password_reset', accountId: account.id, requestId: context.requestId, errorClass: error?.name || 'Error' }); }
      this.audit.emit({ event: 'password_reset_requested', accountId: account.id, requestId: context.requestId, ip: context.ip });
    } else this.audit.emit({ event: 'password_reset_requested_unknown', requestId: context.requestId, ip: context.ip });
    return { accepted: true };
  }

  async confirmPasswordReset(input, context) {
    const now = this.clock();
    await this.securityGate.assertRate(`reset-confirm:ip:${context.ip}`, { limit: 10, windowMs: 15 * 60_000 }, now);
    validatePassword(input.newPassword);
    const record = await this.repository.consumeActionToken('password_reset', digestToken(requireToken(input.token)), now);
    if (!record) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token is invalid or expired');
    const target = await this.#findById(record.accountId);
    if (!target) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token is invalid or expired');
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.repository.updateAccount(target.id, { passwordHash, passwordVersion: target.passwordVersion + 1, updatedAt: now });
    this.audit.emit({ event: 'password_reset_completed', accountId: target.id, requestId: context.requestId, ip: context.ip });
    return { changed: true };
  }

  async requestVerification(input, context) {
    const now = this.clock();
    await this.securityGate.assertRate(`verify:ip:${context.ip}`, { limit: 5, windowMs: 15 * 60_000 }, now);
    const account = await this.#findAccountSelector(input);
    if (account && !account.verifiedAt) await this.#issueVerification(account, context, now);
    return { accepted: true };
  }

  async confirmVerification(input, context) {
    const now = this.clock();
    await this.securityGate.assertRate(`verify-confirm:ip:${context.ip}`, { limit: 10, windowMs: 15 * 60_000 }, now);
    const record = await this.repository.consumeActionToken('account_verification', digestToken(requireToken(input.token)), now);
    if (!record) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token is invalid or expired');
    const account = await this.#findById(record.accountId);
    if (!account) throw new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token is invalid or expired');
    if (!account.verifiedAt) await this.repository.updateAccount(account.id, { verifiedAt: now, updatedAt: now });
    this.audit.emit({ event: 'account_verified', accountId: account.id, requestId: context.requestId, ip: context.ip });
    return { verified: true };
  }

  async #authenticate(input, context) {
    const now = this.clock();
    const rawIdentifier = input?.identifier ?? input?.username;
    const presentedPassword = exactPresentedPassword(input?.password);
    if (typeof rawIdentifier !== 'string' || !rawIdentifier.trim() || !presentedPassword) throw unauthorized();
    let account; let credentialKey;
    if (rawIdentifier.includes('@')) {
      const email = normalizeEmail(rawIdentifier); credentialKey = `email:${email}`; account = await this.repository.findByEmail(email);
    } else {
      const { canonical } = normalizeUsername(rawIdentifier); credentialKey = `username:${canonical}`; account = await this.repository.findByUsernameCanonical(canonical);
    }
    await this.securityGate.assertCredentialAllowed(context.ip, credentialKey, now);
    const valid = account && await this.hasher.verify(presentedPassword, account.passwordHash);
    if (!valid) {
      await this.securityGate.recordCredentialFailure(context.ip, credentialKey, now);
      this.audit.emit({ event: 'access_check_failed', credentialKey, requestId: context.requestId, ip: context.ip });
      throw unauthorized();
    }
    await this.securityGate.clearCredentialFailures(context.ip, credentialKey);
    const ban = activeBan(account, now);
    if (ban) {
      this.audit.emit({ event: 'access_check_banned', accountId: account.id, requestId: context.requestId, ip: context.ip, banCode: ban.code });
      throw locked('ACCOUNT_BANNED', 'Account access is suspended', ban);
    }
    if (!account.verifiedAt) throw forbidden('ACCOUNT_UNVERIFIED', 'Account verification is required');
    const credentialUpgradeRequired = !isGameCompatiblePassword(presentedPassword);
    this.audit.emit({ event: 'access_check_succeeded', accountId: account.id, requestId: context.requestId, ip: context.ip, credentialUpgradeRequired });
    return { account, credentialUpgradeRequired };
  }

  async #issueVerification(account, context, now) {
    const token = newOpaqueToken();
    await this.repository.createActionToken({ id: newId(), kind: 'account_verification', accountId: account.id, digest: digestToken(token), expiresAt: now + VERIFY_TTL_MS, consumedAt: null, createdAt: now });
    try {
      const accepted = await this.delivery.sendVerification({ accountId: account.id, email: account.email, token, expiresAt: now + VERIFY_TTL_MS });
      if (accepted?.accepted) this.audit.emit({ event: 'delivery_provider_accepted', kind: 'account_verification', accountId: account.id, requestId: context.requestId, provider: accepted.provider, providerMessageId: accepted.providerMessageId });
    } catch (error) { this.audit.emit({ event: 'delivery_failed', kind: 'account_verification', accountId: account.id, requestId: context.requestId, errorClass: error?.name || 'Error' }); }
    this.audit.emit({ event: 'verification_requested', accountId: account.id, requestId: context.requestId, ip: context.ip });
  }

  async #findAccountSelector(input) {
    const hasEmail = typeof input?.email === 'string' && input.email.trim().length > 0;
    const hasUsername = typeof input?.username === 'string' && input.username.trim().length > 0;
    if (Number(hasEmail) + Number(hasUsername) !== 1) throw badRequest('INVALID_SELECTOR', 'Provide exactly one of username or email');
    if (hasEmail) return this.repository.findByEmail(normalizeEmail(input.email));
    return this.repository.findByUsernameCanonical(normalizeUsername(input.username).canonical);
  }

  async #findById(id) { return this.repository.findById(id); }
}
