export type OldKOEnvironment = "development" | "test" | "production";
export type DatabaseDriver = "postgres" | "mssql";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type SecretSource =
  | { readonly kind: "reference"; readonly reference: string }
  | { readonly kind: "literal"; readonly value: string };

export interface HostPort {
  readonly host: string;
  readonly port: number;
}

export interface RuntimeConfig {
  readonly env: OldKOEnvironment;
  readonly service: {
    readonly name: string;
    readonly host: string;
    readonly port?: number;
  };
  readonly database: {
    readonly enabled: boolean;
    readonly driver?: DatabaseDriver;
    readonly host?: string;
    readonly port?: number;
    readonly name?: string;
    readonly user?: string;
    readonly password?: SecretSource;
  };
  readonly gateway: {
    readonly enabled: boolean;
    readonly authTargetUrl?: string;
    readonly gameTargetUrl?: string;
  };
  readonly network: {
    readonly auth?: HostPort;
    readonly game?: HostPort;
  };
  readonly adminApi: {
    readonly enabled: boolean;
    readonly host?: string;
    readonly port?: number;
    readonly baseUrl?: string;
    readonly sessionSecret?: SecretSource;
    readonly gameCommandToken?: SecretSource;
  };
  readonly observability: {
    readonly logLevel: LogLevel;
    readonly logJson: boolean;
    readonly metrics: {
      readonly enabled: boolean;
      readonly host: string;
      readonly port?: number;
    };
    readonly healthPath: string;
  };
  readonly cors: {
    readonly trustedOrigins: readonly string[];
    readonly credentials: boolean;
  };
  readonly timeouts: {
    readonly startupMs: number;
    readonly requestMs: number;
    readonly databaseMs: number;
    readonly gatewayMs: number;
  };
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

export interface ValidationIssue {
  readonly key: string;
  readonly message: string;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
}

export interface LoadConfigOptions {
  readonly allowUnknown?: boolean;
}

export function loadConfig(
  source?: Record<string, string | undefined>,
  options?: LoadConfigOptions
): RuntimeConfig;

export function redactEnv<T extends Record<string, unknown>>(source?: T): Record<string, unknown>;
export function redactConfig<T>(config: T): unknown;

export const ENVIRONMENTS: readonly OldKOEnvironment[];
export const KNOWN_ENV_KEYS: readonly string[];
export const RESERVED_LITERAL_SECRET_KEYS: readonly string[];
export const SECRET_REFERENCE_PATTERN: RegExp;
export const DEFAULTS: Readonly<Record<string, unknown>>;
