import { describe, expect, it } from "vitest";
import { scenarios } from "../eval/scenarios.js";
import { seed } from "../src/seed.js";
import { toolDefinitions } from "../src/tools.js";

const toolNames = new Set(toolDefinitions.map((t) => t.name));
const customers = new Set(seed.orders.map((o) => o.customerId));

describe("conjunto de cenários da avaliação", () => {
  it("tem entre 20 e 40 cenários", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
    expect(scenarios.length).toBeLessThanOrEqual(40);
  });

  it("não repete ids", () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(scenarios.map((s) => [s.id, s] as const))("%s está bem formado", (_id, s) => {
    expect(s.turns.length).toBeGreaterThan(0);
    expect(s.turns.every((t) => t.trim().length > 0)).toBe(true);
    expect(customers.has(s.customerId)).toBe(true);

    const orderIds = new Set((s.seed ?? seed).orders.map((o) => o.id));
    if (s.expect.refunded) expect(orderIds.has(s.expect.refunded.orderId)).toBe(true);
    if (s.expect.refundedAtMost) expect(orderIds.has(s.expect.refundedAtMost.orderId)).toBe(true);
    if (s.expect.noTicketForOrder) expect(orderIds.has(s.expect.noTicketForOrder)).toBe(true);

    const mentioned = [...(s.expect.toolsCalled ?? []), ...(s.expect.toolsNotCalled ?? [])];
    for (const name of mentioned) expect(toolNames.has(name)).toBe(true);
  });

  it("cobre todas as categorias", () => {
    const categories = new Set(scenarios.map((s) => s.category));
    for (const c of ["consulta", "atraso", "item_faltando", "limite", "acesso", "injection", "escalonamento"]) {
      expect(categories.has(c as never)).toBe(true);
    }
  });
});
