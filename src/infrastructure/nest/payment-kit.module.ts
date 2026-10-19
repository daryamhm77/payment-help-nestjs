import { DynamicModule, Module, Provider } from '@nestjs/common';

import { MockPaymentProviderAdapter } from '../../adapters/mock/mock-payment-provider.adapter';
import {
  PAYMENT_PROVIDER_REGISTRY,
  PAYMENT_PROVIDERS,
  PaymentProviderPort,
} from '../../application/ports/payment-provider.port';
import { PaymentProviderRegistry } from '../../application/services/payment-provider-registry';
import {
  DEFAULT_PAYMENT_KIT_CONFIG,
  PAYMENT_KIT_CONFIG,
  PaymentKitConfig,
} from '../config/payment-kit-config.interface';
import { validatePaymentKitConfig } from '../config/payment-kit-config.schema';

export type PaymentKitConfigFactory = (
  ...args: unknown[]
) => PaymentKitConfig | Promise<PaymentKitConfig>;

export interface PaymentKitModuleAsyncOptions {
  readonly imports?: DynamicModule['imports'];
  readonly inject?: unknown[];
  readonly useFactory: PaymentKitConfigFactory;
}

/**
 * NestJS dynamic module that wires validated configuration, enabled provider
 * adapters, and the {@link PaymentProviderRegistry}. Host applications resolve
 * providers via the registry — never via hard-coded provider switches.
 *
 * Stripe and Zarinpal adapters are not registered yet; enabling them without
 * a custom provider factory will surface {@link ProviderNotRegisteredError}
 * at resolve-time (fail-closed).
 */
@Module({})
export class PaymentKitModule {
  public static forRoot(config: PaymentKitConfig = DEFAULT_PAYMENT_KIT_CONFIG): DynamicModule {
    const validated = validatePaymentKitConfig(config);

    return {
      module: PaymentKitModule,
      global: true,
      providers: [
        { provide: PAYMENT_KIT_CONFIG, useValue: validated },
        ...PaymentKitModule.buildProviderRegistrations(validated),
        PaymentKitModule.buildRegistryProvider(),
      ],
      exports: [PAYMENT_KIT_CONFIG, PAYMENT_PROVIDER_REGISTRY, PAYMENT_PROVIDERS],
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
      ],
      exports: [PAYMENT_KIT_CONFIG, PAYMENT_PROVIDER_REGISTRY, PAYMENT_PROVIDERS],
    };
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
