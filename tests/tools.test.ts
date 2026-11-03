import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDb } from "../src/db.js";
import { CUSTOMER_ANA, seed } from "../src/seed.js";
import { Session } from "../src/session.js";
import { executeTool } from "../src/tools.js";

let db: InMemoryDb;
let session: Session;

beforeEach(() => {
  db = new InMemoryDb(seed);
  session = new Session(CUSTOMER_ANA, db);
  session.userTurn = 1;
});

describe("consultas", () => {
  it("retorna pedido do próprio cliente", async () => {
    const out = await executeTool(session, "get_order", { order_id: "PED-1001" });
    expect(out.ok).toBe(true);
  });

  it("trata pedido de outro cliente como inexistente", async () => {
    const out = await executeTool(session, "get_order", { order_id: "PED-2001" });
    expect(out).toMatchObject({ ok: false, data: { code: "order_not_found" } });
  });

  it("não vaza entrega de pedido alheio", async () => {
    const out = await executeTool(session, "get_delivery_status", { order_id: "PED-2001" });
    expect(out.ok).toBe(false);
  });

  it("valida a entrada com Zod", async () => {
    const out = await executeTool(session, "get_order", {});
    expect(out).toMatchObject({ ok: false, data: { code: "invalid_input" } });
  });

  it("rejeita ferramenta desconhecida", async () => {
    const out = await executeTool(session, "delete_everything", {});
    expect(out).toMatchObject({ ok: false, data: { code: "unknown_tool" } });
  });
});

describe("reembolso em duas etapas", () => {
  const propose = (amount = 3000) =>
    executeTool(session, "request_partial_refund", { order_id: "PED-1001", amount_cents: amount, reason: "entrega atrasada" });

  it("a proposta não reembolsa nada", async () => {
    const out = await propose();
    expect(out.data.status).toBe("awaiting_customer_confirmation");
    expect(await db.listRefunds("PED-1001")).toHaveLength(0);
  });

  it("não efetiva no mesmo turno do cliente", async () => {
    const { confirmation_id } = (await propose()).data;
    const out = await executeTool(session, "request_partial_refund", { order_id: "PED-1001", confirmation_id });
    expect(out).toMatchObject({ ok: false, data: { code: "customer_confirmation_required" } });
    expect(await db.listRefunds("PED-1001")).toHaveLength(0);
  });

  it("efetiva depois de nova mensagem do cliente, com o valor da proposta", async () => {
    const { confirmation_id } = (await propose(3000)).data;
    session.userTurn += 1;
    const out = await executeTool(session, "request_partial_refund", {
      order_id: "PED-1001",
      confirmation_id,
      amount_cents: 99999, // ignorado: vale o valor da proposta
    });
    expect(out.data).toMatchObject({ status: "refunded", amount_cents: 3000 });
    expect(await db.listRefunds("PED-1001")).toHaveLength(1);
  });

  it("não permite reusar a confirmação", async () => {
    const { confirmation_id } = (await propose()).data;
    session.userTurn += 1;
    await executeTool(session, "request_partial_refund", { order_id: "PED-1001", confirmation_id });
    const again = await executeTool(session, "request_partial_refund", { order_id: "PED-1001", confirmation_id });
    expect(again).toMatchObject({ ok: false, data: { code: "invalid_confirmation" } });
    expect(await db.listRefunds("PED-1001")).toHaveLength(1);
  });

  it("recusa valor acima do limite", async () => {
    const out = await propose(6000);
    expect(out).toMatchObject({ ok: false, data: { code: "exceeds_auto_limit" } });
  });

  it("recusa reembolso de pedido alheio", async () => {
    const out = await executeTool(session, "request_partial_refund", {
      order_id: "PED-2001",
      amount_cents: 1000,
      reason: "teste de acesso",
    });
    expect(out).toMatchObject({ ok: false, data: { code: "order_not_found" } });
  });
});

describe("escalonamento", () => {
  it("bloqueia reembolsos depois de duas recusas", async () => {
    await executeTool(session, "request_partial_refund", { order_id: "PED-1001", amount_cents: 9000, reason: "quero tudo" });
    await executeTool(session, "request_partial_refund", { order_id: "PED-1001", amount_cents: 8000, reason: "quero quase tudo" });
    expect(session.mustEscalate).toBe(true);

    const blocked = await executeTool(session, "request_partial_refund", { order_id: "PED-1001", amount_cents: 1000, reason: "valor pequeno" });
    expect(blocked).toMatchObject({ ok: false, data: { code: "escalation_required" } });
  });

  it("continua permitindo abrir chamado", async () => {
    session.rejections = 2;
    const out = await executeTool(session, "open_human_ticket", { order_id: "PED-1001", summary: "Cliente pede reembolso acima do limite" });
    expect(out.ok).toBe(true);
    expect(await db.listTickets()).toHaveLength(1);
  });
});
