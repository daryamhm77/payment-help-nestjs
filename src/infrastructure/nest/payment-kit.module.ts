import { DynamicModule, Module, Provider, Type } from '@nestjs/common';

import { MockPaymentProviderAdapter } from '../../adapters/mock/mock-payment-provider.adapter';
import {
  IDEMPOTENCY_STORE,
  IdempotencyStorePort,
} from '../../application/ports/idempotency-store.port';
import {
  PAYMENT_PROVIDER_REGISTRY,
  PAYMENT_PROVIDERS,
  PaymentProviderPort,
} from '../../application/ports/payment-provider.port';
import {
  PAYMENT_REPOSITORY,
  PaymentRepositoryPort,
} from '../../application/ports/payment-repository.port';
import { PaymentProviderRegistry } from '../../application/services/payment-provider-registry';
import {
  CREATE_PAYMENT_USE_CASE,
  CreatePaymentUseCase,
} from '../../application/use-cases/create-payment.use-case';
import {
  GET_PAYMENT_STATUS_USE_CASE,
  GetPaymentStatusUseCase,
} from '../../application/use-cases/get-payment-status.use-case';
import {
  REFUND_PAYMENT_USE_CASE,
  RefundPaymentUseCase,
} from '../../application/use-cases/refund-payment.use-case';
import {
  VERIFY_PAYMENT_USE_CASE,
  VerifyPaymentUseCase,
} from '../../application/use-cases/verify-payment.use-case';
import {
  DEFAULT_PAYMENT_KIT_CONFIG,
  PAYMENT_KIT_CONFIG,
  PaymentKitConfig,
} from '../config/payment-kit-config.interface';
import { validatePaymentKitConfig } from '../config/payment-kit-config.schema';

export type PaymentKitConfigFactory = (
  ...args: unknown[]
) => PaymentKitConfig | Promise<PaymentKitConfig>;

export interface PaymentKitPersistenceProviders {
  readonly paymentRepository: Type<PaymentRepositoryPort> | PaymentRepositoryPort;
  readonly idempotencyStore: Type<IdempotencyStorePort> | IdempotencyStorePort;
}

export interface PaymentKitModuleAsyncOptions {
  readonly imports?: DynamicModule['imports'];
  readonly inject?: unknown[];
  readonly useFactory: PaymentKitConfigFactory;
  /**
   * Host-supplied durable persistence. Required to register orchestration use
   * cases. In-memory doubles must not be used in production.
   */
  readonly persistence?: PaymentKitPersistenceProviders;
}

export interface PaymentKitModuleRootOptions extends PaymentKitConfig {
  readonly persistence?: PaymentKitPersistenceProviders;
}

/**
 * NestJS dynamic module that wires validated configuration, enabled provider
 * adapters, the {@link PaymentProviderRegistry}, and (when persistence is
 * provided) orchestration use cases.
 */
@Module({})
export class PaymentKitModule {
  public static forRoot(config: PaymentKitModuleRootOptions = DEFAULT_PAYMENT_KIT_CONFIG): DynamicModule {
    const { persistence, ...kitConfig } = config;
    const validated = validatePaymentKitConfig(kitConfig);

    const persistenceProviders = PaymentKitModule.buildPersistenceAndUseCases(persistence);
    const providers: Provider[] = [
      { provide: PAYMENT_KIT_CONFIG, useValue: validated },
      ...PaymentKitModule.buildProviderRegistrations(validated),
      PaymentKitModule.buildRegistryProvider(),
      ...persistenceProviders,
    ];

    return {
      module: PaymentKitModule,
      global: true,
      providers,
      exports: [
        PAYMENT_KIT_CONFIG,
        PAYMENT_PROVIDER_REGISTRY,
        PAYMENT_PROVIDERS,
        ...PaymentKitModule.persistenceExports(persistenceProviders.length > 0),
      ],
    };
  }

  public static forRootAsync(options: PaymentKitModuleAsyncOptions): DynamicModule {
    const configProvider: Provider = {
      provide: PAYMENT_KIT_CONFIG,
      useFactory: async (...args: unknown[]): Promise<PaymentKitConfig> => {
        const resolved = await options.useFactory(...args);
        return validatePaymentKitConfig(resolved);
      },
      inject: (options.inject ?? []) as never[],
    };

    const persistenceProviders = PaymentKitModule.buildPersistenceAndUseCases(options.persistence);

    return {
      module: PaymentKitModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        configProvider,
        {
          provide: PAYMENT_PROVIDERS,
          useFactory: (config: PaymentKitConfig): PaymentProviderPort[] =>
            PaymentKitModule.instantiateEnabledProviders(config),
          inject: [PAYMENT_KIT_CONFIG],
        },
        PaymentKitModule.buildRegistryProvider(),
        ...persistenceProviders,
      ],
      exports: [
        PAYMENT_KIT_CONFIG,
        PAYMENT_PROVIDER_REGISTRY,
        PAYMENT_PROVIDERS,
        ...PaymentKitModule.persistenceExports(persistenceProviders.length > 0),
      ],
    };
  }

  private static persistenceExports(include: boolean): Array<string | symbol> {
    if (!include) {
      return [];
    }

    return [
      PAYMENT_REPOSITORY,
      IDEMPOTENCY_STORE,
      CREATE_PAYMENT_USE_CASE,
      VERIFY_PAYMENT_USE_CASE,
      GET_PAYMENT_STATUS_USE_CASE,
      REFUND_PAYMENT_USE_CASE,
    ];
  }

  private static buildPersistenceAndUseCases(
    persistence: PaymentKitPersistenceProviders | undefined,
  ): Provider[] {
    if (persistence === undefined) {
      return [];
    }

    const repositoryProvider: Provider =
      typeof persistence.paymentRepository === 'function'
        ? { provide: PAYMENT_REPOSITORY, useClass: persistence.paymentRepository }
        : { provide: PAYMENT_REPOSITORY, useValue: persistence.paymentRepository };

    const idempotencyProvider: Provider =
      typeof persistence.idempotencyStore === 'function'
        ? { provide: IDEMPOTENCY_STORE, useClass: persistence.idempotencyStore }
        : { provide: IDEMPOTENCY_STORE, useValue: persistence.idempotencyStore };

    return [
      repositoryProvider,
      idempotencyProvider,
      {
        provide: CREATE_PAYMENT_USE_CASE,
        useFactory: (
          payments: PaymentRepositoryPort,
          idempotency: IdempotencyStorePort,
          providers: PaymentProviderRegistry,
        ): CreatePaymentUseCase =>
          new CreatePaymentUseCase({ payments, idempotency, providers }),
        inject: [PAYMENT_REPOSITORY, IDEMPOTENCY_STORE, PAYMENT_PROVIDER_REGISTRY],
      },
      {
        provide: VERIFY_PAYMENT_USE_CASE,
        useFactory: (
          payments: PaymentRepositoryPort,
          idempotency: IdempotencyStorePort,
          providers: PaymentProviderRegistry,
        ): VerifyPaymentUseCase =>
          new VerifyPaymentUseCase({ payments, idempotency, providers }),
        inject: [PAYMENT_REPOSITORY, IDEMPOTENCY_STORE, PAYMENT_PROVIDER_REGISTRY],
      },
      {
        provide: GET_PAYMENT_STATUS_USE_CASE,
        useFactory: (
          payments: PaymentRepositoryPort,
          providers: PaymentProviderRegistry,
        ): GetPaymentStatusUseCase => new GetPaymentStatusUseCase({ payments, providers }),
        inject: [PAYMENT_REPOSITORY, PAYMENT_PROVIDER_REGISTRY],
      },
      {
        provide: REFUND_PAYMENT_USE_CASE,
        useFactory: (
          payments: PaymentRepositoryPort,
          idempotency: IdempotencyStorePort,
          providers: PaymentProviderRegistry,
        ): RefundPaymentUseCase =>
          new RefundPaymentUseCase({ payments, idempotency, providers }),
        inject: [PAYMENT_REPOSITORY, IDEMPOTENCY_STORE, PAYMENT_PROVIDER_REGISTRY],
      },
    ];
  }

  private static buildProviderRegistrations(config: PaymentKitConfig): Provider[] {
    return [
      {
        provide: PAYMENT_PROVIDERS,
        useFactory: (): PaymentProviderPort[] =>
          PaymentKitModule.instantiateEnabledProviders(config),
      },
    ];
  }

  private static buildRegistryProvider(): Provider {
    return {
      provide: PAYMENT_PROVIDER_REGISTRY,
      useFactory: (
        config: PaymentKitConfig,
        providers: PaymentProviderPort[],
      ): PaymentProviderRegistry => new PaymentProviderRegistry(config, providers),
      inject: [PAYMENT_KIT_CONFIG, PAYMENT_PROVIDERS],
    };
  }

  private static instantiateEnabledProviders(config: PaymentKitConfig): PaymentProviderPort[] {
    const adapters: PaymentProviderPort[] = [];

    if (config.enabledProviders.includes('mock')) {
      adapters.push(new MockPaymentProviderAdapter(config.mock ?? {}));
    }

    return adapters;
  }
}
