import { describe, expect, it } from "vitest";
import { AUTO_REFUND_LIMIT_CENTS, checkRefund } from "../src/rules.js";
import type { Order } from "../src/types.js";

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "PED-T",
  customerId: "CLI-T",
  restaurant: "Teste",
  items: [],
  totalCents: 8900,
  status: "delivered",
  placedAt: "2026-11-02T19:00:00-03:00",
  promisedAt: "2026-11-02T19:45:00-03:00",
  deliveredAt: "2026-11-02T19:50:00-03:00",
  ...overrides,
});

describe("checkRefund", () => {
  it("aceita valor dentro do limite", () => {
    expect(checkRefund(order(), 3000, 0)).toBeNull();
  });

  it("aceita exatamente o limite automático", () => {
    expect(checkRefund(order(), AUTO_REFUND_LIMIT_CENTS, 0)).toBeNull();
  });

  it("recusa valor acima do limite automático", () => {
    expect(checkRefund(order(), AUTO_REFUND_LIMIT_CENTS + 1, 0)?.code).toBe("exceeds_auto_limit");
  });

  it("soma reembolsos anteriores ao limite", () => {
    expect(checkRefund(order(), 2000, 4000)?.code).toBe("exceeds_auto_limit");
  });

  it("recusa passar do valor do pedido", () => {
    expect(checkRefund(order({ totalCents: 3200 }), 2000, 2000)?.code).toBe("exceeds_order_balance");
  });

  it("recusa pedido não entregue", () => {
    expect(checkRefund(order({ status: "out_for_delivery" }), 1000, 0)?.code).toBe("order_not_refundable");
    expect(checkRefund(order({ status: "cancelled" }), 1000, 0)?.code).toBe("order_not_refundable");
  });

  it.each([0, -100, 10.5, Number.NaN])("recusa valor inválido %s", (amount) => {
    expect(checkRefund(order(), amount, 0)?.code).toBe("invalid_amount");
  });
});
