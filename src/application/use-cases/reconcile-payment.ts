import { PaymentStatus } from '../../domain/payment-status';
import { Payment } from '../../domain/payment.entity';
import { PaymentStatusResult } from '../dto/provider-charge.dto';
import { PaymentProviderPort } from '../ports/payment-provider.port';
import { PaymentRepositoryPort } from '../ports/payment-repository.port';

/**
 * Applies a definitive provider status result onto a local payment.
 * Leaves the payment unchanged when the provider still reports processing/unknown.
 */
export function applyStatusResult(payment: Payment, result: PaymentStatusResult): boolean {
  if (result.outcome === 'succeeded') {
    if (payment.getStatus() === PaymentStatus.SUCCEEDED) {
      return false;
    }
    if (payment.getStatus() === PaymentStatus.PROCESSING) {
      payment.transitionTo(PaymentStatus.SUCCEEDED, {
        providerReference: result.providerReference,
      });
      return true;
    }
    if (
      payment.getStatus() === PaymentStatus.UNKNOWN ||
      payment.getStatus() === PaymentStatus.REQUIRES_ACTION
    ) {
      payment.transitionTo(PaymentStatus.SUCCEEDED, {
        providerReference: result.providerReference,
      });
      return true;
    }
    return false;
  }

  if (result.outcome === 'failed') {
    if (
      payment.getStatus() === PaymentStatus.FAILED ||
      payment.getStatus() === PaymentStatus.REFUNDED ||
      payment.getStatus() === PaymentStatus.CANCELED
    ) {
      return false;
    }
    payment.transitionTo(PaymentStatus.FAILED, {
      providerReference: result.providerReference,
      failureReason: result.reason,
    });
    return true;
  }

  return false;
}

/**
 * Queries the provider for authoritative status. Used after timeouts and on
 * explicit reconcile — never treats a browser redirect as success by itself.
 */
export async function reconcileWithProvider(
  payment: Payment,
  provider: PaymentProviderPort,
  payments: PaymentRepositoryPort,
): Promise<Payment> {
  if (!provider.getCapabilities().getPaymentStatus) {
    return payment;
  }

  const result = await provider.getPaymentStatus({
    paymentId: payment.getId(),
    providerReference: payment.getProviderReference(),
  });

  if (applyStatusResult(payment, result)) {
    await payments.save(payment);
  }

  return payment;
}
