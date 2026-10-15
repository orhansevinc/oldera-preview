export type ActorIdentity = Readonly<{
  id: string;
  type: 'user' | 'service';
  roles: readonly string[];
  authnMethod: string;
  sessionId?: string;
}>;

export type AuditMetadata = Readonly<Record<string, string | number | boolean>>;

export type CommandArgs = {
  'player.kick': { playerId: string };
  'player.teleport': { playerId: string; zoneId: number; x: number; z: number; y?: number };
  'player.summon': { playerId: string; toPlayerId: string };
  'account.ban': { accountId: string; durationSeconds?: number };
  'account.unban': { accountId: string };
  'chat.mute': { playerId: string; durationSeconds: number };
  'chat.unmute': { playerId: string };
  'notice.zone': { zoneId: number; message: string };
  'notice.global': { message: string };
  'server.player-count': Record<string, never>;
};

export type CommandId = keyof CommandArgs;

export type CommandRequest<K extends CommandId = CommandId> = Readonly<{
  requestId: string;
  command: K;
  actor: ActorIdentity;
  reason: string;
  args: CommandArgs[K];
  dryRun?: boolean;
  metadata?: AuditMetadata;
}>;

export type CommandResult = Readonly<{
  requestId: string | null;
  command: string | null;
  status: 'ok' | 'dry-run' | 'failed';
  code: string;
  message: string;
  data?: unknown;
  idempotentReplay?: boolean;
  auditDegraded?: boolean;
}>;

export interface CommandAuthorizer {
  authorize(input: {
    actor: ActorIdentity;
    permission: string;
    command: CommandId;
    risk: 'low' | 'medium' | 'high' | 'critical';
    target: { type: string; id: string };
    reason: string;
    requestId: string;
    metadata: AuditMetadata;
  }): Promise<{ allowed: boolean; reason?: string }>;
}

export interface AuditSink {
  append(event: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface IdempotencyStore {
  run<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<{ value: T; replayed: boolean }>;
}

export interface GameOperationsAdapter {
  kickPlayer(input: unknown): Promise<unknown>;
  previewKickPlayer(input: unknown): Promise<unknown>;
  teleportPlayer(input: unknown): Promise<unknown>;
  previewTeleportPlayer(input: unknown): Promise<unknown>;
  summonPlayer(input: unknown): Promise<unknown>;
  previewSummonPlayer(input: unknown): Promise<unknown>;
}

export interface ModerationAdapter {
  banAccount(input: unknown): Promise<unknown>;
  previewBanAccount(input: unknown): Promise<unknown>;
  unbanAccount(input: unknown): Promise<unknown>;
  previewUnbanAccount(input: unknown): Promise<unknown>;
  mutePlayer(input: unknown): Promise<unknown>;
  previewMutePlayer(input: unknown): Promise<unknown>;
  unmutePlayer(input: unknown): Promise<unknown>;
  previewUnmutePlayer(input: unknown): Promise<unknown>;
}

export interface NoticeAdapter {
  sendZoneNotice(input: unknown): Promise<unknown>;
  sendGlobalNotice(input: unknown): Promise<unknown>;
}

export interface ObservabilityAdapter {
  getPlayerCount(input: unknown): Promise<unknown>;
}

export type Adapters = {
  gameOperations?: Partial<GameOperationsAdapter>;
  moderation?: Partial<ModerationAdapter>;
  notices?: Partial<NoticeAdapter>;
  observability?: Partial<ObservabilityAdapter>;
};

export class ServiceUnavailableError extends Error {
  code: 'SERVICE_UNAVAILABLE';
  service: string;
  constructor(service: string, message?: string);
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  constructor(options?: { now?: () => number });
  run<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<{ value: T; replayed: boolean }>;
  prune(): void;
}

export class CommandBus {
  execute(request: CommandRequest | Record<string, unknown>): Promise<CommandResult>;
}

export function createCommandRegistry(adapters?: Adapters): ReadonlyMap<CommandId, unknown>;
export function createGmCommandBus(options: {
  adapters?: Adapters;
  registry?: ReadonlyMap<CommandId, unknown>;
  authorizer: CommandAuthorizer;
  auditSink: AuditSink;
  idempotencyStore?: IdempotencyStore;
  timeoutMs?: number;
  idempotencyTtlMs?: number;
  now?: () => number;
}): CommandBus;
