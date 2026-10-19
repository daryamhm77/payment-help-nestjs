import { PaymentNotFoundError } from '../../domain/errors/payment-persistence-errors';
import { PaymentStatus } from '../../domain/payment-status';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';
import { GetPaymentStatusCommand, PaymentOperationResult } from '../dto/orchestration.dto';
import { PaymentRepositoryPort } from '../ports/payment-repository.port';
import { PaymentProviderRegistry } from '../services/payment-provider-registry';

import { reconcileWithProvider } from './reconcile-payment';

export interface GetPaymentStatusUseCaseDeps {
  readonly payments: PaymentRepositoryPort;
  readonly providers: PaymentProviderRegistry;
}

/**
 * Returns the local payment status. Optionally reconciles with the provider
 * when the local state is non-terminal / UNKNOWN. Never marks success based
 * solely on a browser redirect — reconciliation uses the provider API.
 */
export class GetPaymentStatusUseCase {
  public constructor(private readonly deps: GetPaymentStatusUseCaseDeps) {}

  public async execute(command: GetPaymentStatusCommand): Promise<PaymentOperationResult> {
    const scope = MerchantScope.fromString(command.merchantScope);
    const paymentId = PaymentId.fromString(command.paymentId);
    let payment = await this.deps.payments.findByIdInScope(scope, paymentId);

    if (payment === null) {
      throw new PaymentNotFoundError(command.paymentId);
    }

    const shouldReconcile =
      command.reconcile === true ||
      (command.reconcile !== false &&
        (payment.getStatus() === PaymentStatus.UNKNOWN ||
          payment.getStatus() === PaymentStatus.PROCESSING));

    if (shouldReconcile) {
      const provider = this.deps.providers.resolve(payment.getProviderName());
      payment = await reconcileWithProvider(payment, provider, this.deps.payments);
    }

    return {
      payment: payment.toSnapshot(),
      replayed: false,
      status: payment.getStatus(),
    };
  }
}

export const GET_PAYMENT_STATUS_USE_CASE = Symbol('GET_PAYMENT_STATUS_USE_CASE');
