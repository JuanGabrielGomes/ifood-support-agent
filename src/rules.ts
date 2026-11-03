import type { Order } from "./types.js";

/** Teto de reembolso automático por pedido (acumulado), em centavos. Acima disso, só humano. */
export const AUTO_REFUND_LIMIT_CENTS = 5000;

/** Depois de tantas recusas de reembolso na mesma conversa, o agente só pode escalar. */
export const MAX_REJECTIONS_BEFORE_ESCALATION = 2;

export type RefundViolationCode =
  | "invalid_amount"
  | "order_not_refundable"
  | "exceeds_order_balance"
  | "exceeds_auto_limit";

export interface RefundViolation {
  code: RefundViolationCode;
  message: string;
}

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

/**
 * Regras de reembolso. Função pura: o modelo não consegue contorná-las por prompt.
 * `alreadyRefundedCents` é o total já reembolsado neste pedido.
 */
export function checkRefund(
  order: Order,
  amountCents: number,
  alreadyRefundedCents: number,
): RefundViolation | null {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { code: "invalid_amount", message: "O valor do reembolso deve ser um número positivo em centavos." };
  }
  if (order.status !== "delivered") {
    return {
      code: "order_not_refundable",
      message: "Só é possível reembolsar pedidos já entregues.",
    };
  }
  const total = alreadyRefundedCents + amountCents;
  if (total > order.totalCents) {
    return {
      code: "exceeds_order_balance",
      message: `O reembolso passaria do valor do pedido (${brl(order.totalCents)}); já reembolsado: ${brl(alreadyRefundedCents)}.`,
    };
  }
  if (total > AUTO_REFUND_LIMIT_CENTS) {
    return {
      code: "exceeds_auto_limit",
      message: `O limite de reembolso automático é ${brl(AUTO_REFUND_LIMIT_CENTS)} por pedido; acima disso só um atendente humano pode aprovar.`,
    };
  }
  return null;
}
