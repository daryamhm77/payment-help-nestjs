import { plainToInstance } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

import { InvalidProviderSelectionError } from '../../domain/errors/payment-provider-errors';

import {
  DEFAULT_PAYMENT_KIT_CONFIG,
  PaymentKitConfig,
  SUPPORTED_PROVIDERS,
  SupportedProvider,
} from './payment-kit-config.interface';

/**
 * Raw shape read from `process.env`. Every field is a string because that is
 * what environment variables actually are; validation/coercion happens via
 * class-validator decorators below.
 */
export class PaymentKitEnvironmentVariables {
  @IsIn(SUPPORTED_PROVIDERS)
  public PAYMENT_KIT_DEFAULT_PROVIDER: SupportedProvider =
    DEFAULT_PAYMENT_KIT_CONFIG.defaultProvider;

  /**
   * Comma-separated list of enabled providers, e.g. `"mock,stripe"`.
   * Defaults to the default provider only.
   */
  @IsOptional()
  @IsString()
  public PAYMENT_KIT_ENABLED_PROVIDERS?: string;

  @IsInt()
  @Min(1)
  public PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS: number =
    DEFAULT_PAYMENT_KIT_CONFIG.idempotencyKeyTtlSeconds;
}

class PaymentKitConfigValidationModel {
  @IsIn(SUPPORTED_PROVIDERS)
  public defaultProvider!: SupportedProvider;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(SUPPORTED_PROVIDERS, { each: true })
  public enabledProviders!: SupportedProvider[];

  @IsInt()
  @Min(1)
  public idempotencyKeyTtlSeconds!: number;
}

/**
 * Validates and coerces raw environment variables into a
 * `PaymentKitEnvironmentVariables` instance. Throws an aggregated,
 * human-readable error if validation fails, so misconfiguration is caught at
 * application bootstrap rather than at the first payment request.
 */
export function validatePaymentKitEnvironment(
  rawEnv: Record<string, string | undefined>,
): PaymentKitEnvironmentVariables {
  const raw: Record<string, string | number> = {};

  if (rawEnv.PAYMENT_KIT_DEFAULT_PROVIDER !== undefined) {
    raw.PAYMENT_KIT_DEFAULT_PROVIDER = rawEnv.PAYMENT_KIT_DEFAULT_PROVIDER;
  }

  if (rawEnv.PAYMENT_KIT_ENABLED_PROVIDERS !== undefined) {
    raw.PAYMENT_KIT_ENABLED_PROVIDERS = rawEnv.PAYMENT_KIT_ENABLED_PROVIDERS;
  }

  if (rawEnv.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS !== undefined) {
    raw.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS = Number(
      rawEnv.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS,
    );
  }

  const candidate = plainToInstance(PaymentKitEnvironmentVariables, raw, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(candidate, {
    skipMissingProperties: true,
    whitelist: true,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');

    throw new Error(`Invalid nestjs-payment-kit environment configuration: ${details}`);
  }

  return candidate;
}

/**
 * Parses a comma-separated enabled-providers string into a validated list.
 */
export function parseEnabledProviders(
  raw: string | undefined,
  defaultProvider: SupportedProvider,
): SupportedProvider[] {
  if (raw === undefined || raw.trim() === '') {
    return [defaultProvider];
  }

  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const invalid = parts.filter((part) => !(SUPPORTED_PROVIDERS as readonly string[]).includes(part));

  if (invalid.length > 0) {
    throw new Error(
      `Invalid nestjs-payment-kit environment configuration: unknown provider(s): ${invalid.join(', ')}`,
    );
  }

  return parts as SupportedProvider[];
}

/**
 * Builds a strongly-typed {@link PaymentKitConfig} from validated env vars.
 * Ensures the default provider is included in `enabledProviders`.
 */
export function paymentKitConfigFromEnvironment(
  rawEnv: Record<string, string | undefined>,
): PaymentKitConfig {
  const env = validatePaymentKitEnvironment(rawEnv);
  const enabledProviders = parseEnabledProviders(
    env.PAYMENT_KIT_ENABLED_PROVIDERS,
    env.PAYMENT_KIT_DEFAULT_PROVIDER,
  );

  return validatePaymentKitConfig({
    defaultProvider: env.PAYMENT_KIT_DEFAULT_PROVIDER,
    enabledProviders,
    idempotencyKeyTtlSeconds: env.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS,
  });
}

/**
 * Validates a programmatic {@link PaymentKitConfig} (e.g. from `forRoot`).
 * Fail-closed: default must be enabled; every enabled name must be supported.
 */
export function validatePaymentKitConfig(config: PaymentKitConfig): PaymentKitConfig {
  const candidate = plainToInstance(
    PaymentKitConfigValidationModel,
    {
      defaultProvider: config.defaultProvider,
      enabledProviders: [...config.enabledProviders],
      idempotencyKeyTtlSeconds: config.idempotencyKeyTtlSeconds,
    },
    { exposeDefaultValues: true },
  );

  const errors = validateSync(candidate, {
    whitelist: true,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');

    throw new InvalidProviderSelectionError(
      `Invalid nestjs-payment-kit configuration: ${details}`,
    );
  }

  if (!candidate.enabledProviders.includes(candidate.defaultProvider)) {
    throw new InvalidProviderSelectionError(
      `Default provider "${candidate.defaultProvider}" must be included in enabledProviders`,
    );
  }

  return {
    defaultProvider: candidate.defaultProvider,
    enabledProviders: candidate.enabledProviders,
    idempotencyKeyTtlSeconds: candidate.idempotencyKeyTtlSeconds,
    ...(config.mock !== undefined ? { mock: config.mock } : {}),
  };
}
