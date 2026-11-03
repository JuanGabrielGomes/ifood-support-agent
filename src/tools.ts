import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { checkRefund } from "./rules.js";
import type { Session } from "./session.js";
import type { Order } from "./types.js";

export interface ToolOutcome {
  ok: boolean;
  data: Record<string, unknown>;
}

const ok = (data: Record<string, unknown>): ToolOutcome => ({ ok: true, data });
const fail = (code: string, message: string): ToolOutcome => ({ ok: false, data: { code, message } });

const orderId = z.string().min(1);

const schemas = {
  get_order: z.object({ order_id: orderId }),
  get_delivery_status: z.object({ order_id: orderId }),
  request_partial_refund: z.object({
    order_id: orderId,
    amount_cents: z.number().int().positive().optional(),
    reason: z.string().min(3).optional(),
    confirmation_id: z.string().optional(),
  }),
  open_human_ticket: z.object({
    summary: z.string().min(10),
    order_id: orderId.optional(),
  }),
};

export type ToolName = keyof typeof schemas;

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "get_order",
    description:
      "Consulta um pedido do cliente: restaurante, itens, valor total, status e horários. Só retorna pedidos do próprio cliente.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Código do pedido, ex.: PED-1001" } },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_delivery_status",
    description:
      "Consulta o status da entrega de um pedido: entregador, situação (a caminho, atrasada, entregue) e previsão em minutos.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string", description: "Código do pedido, ex.: PED-1001" } },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "request_partial_refund",
    description:
      "Reembolso parcial em duas etapas. Etapa 1: informe order_id, amount_cents (centavos) e reason; a ferramenta valida as regras e devolve um confirmation_id SEM reembolsar nada. Apresente o valor ao cliente e peça confirmação. Etapa 2, só depois que o cliente confirmar em uma nova mensagem: chame de novo com order_id e confirmation_id para efetivar.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        amount_cents: { type: "integer", description: "Valor em centavos (etapa 1)" },
        reason: { type: "string", description: "Motivo, ex.: item faltando (etapa 1)" },
        confirmation_id: { type: "string", description: "Retornado pela etapa 1 (etapa 2)" },
      },
      required: ["order_id"],
      additionalProperties: false,
    },
  },
  {
    name: "open_human_ticket",
    description:
      "Abre um chamado para um atendente humano. Use quando a regra impedir o que o cliente pede, quando o cliente insistir depois de recusas ou quando o caso fugir do que você consegue resolver.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Resumo do problema e do que já foi tentado" },
        order_id: { type: "string", description: "Pedido relacionado, se houver" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

/** Pedido só existe para o modelo se pertencer ao cliente da sessão. */
async function ownOrder(session: Session, id: string): Promise<Order | null> {
  const order = await session.db.getOrder(id);
  return order && order.customerId === session.customerId ? order : null;
}

const notFound = (id: string) => fail("order_not_found", `Não encontrei o pedido ${id} na conta do cliente.`);

async function refund(session: Session, input: z.infer<typeof schemas.request_partial_refund>): Promise<ToolOutcome> {
  if (session.mustEscalate) {
    return fail("escalation_required", "Reembolsos estão bloqueados nesta conversa. Abra um chamado para um atendente humano.");
  }
  const order = await ownOrder(session, input.order_id);
  if (!order) return notFound(input.order_id);
  const already = (await session.db.listRefunds(order.id)).reduce((sum, r) => sum + r.amountCents, 0);

  if (input.confirmation_id) {
    const proposal = session.proposals.get(input.confirmation_id);
    if (!proposal || proposal.orderId !== order.id) {
      return fail("invalid_confirmation", "Confirmação inexistente para este pedido.");
    }
    if (session.userTurn <= proposal.turn) {
      return fail("customer_confirmation_required", "O cliente ainda não confirmou. Apresente o valor e espere a resposta dele.");
    }
    // O valor vem da proposta guardada, nunca do que o modelo envia na confirmação.
    const violation = checkRefund(order, proposal.amountCents, already);
    if (violation) {
      session.rejections += 1;
      return fail(violation.code, violation.message);
    }
    const done = await session.db.addRefund({ orderId: order.id, amountCents: proposal.amountCents, reason: proposal.reason });
    session.proposals.delete(proposal.id);
    return ok({ status: "refunded", refund_id: done.id, amount_cents: done.amountCents });
  }

  if (input.amount_cents === undefined || !input.reason) {
    return fail("invalid_input", "Informe amount_cents e reason para propor o reembolso.");
  }
  const violation = checkRefund(order, input.amount_cents, already);
  if (violation) {
    session.rejections += 1;
    return fail(violation.code, violation.message);
  }
  const proposal = {
    id: session.nextProposalId(),
    orderId: order.id,
    amountCents: input.amount_cents,
    reason: input.reason,
    turn: session.userTurn,
  };
  session.proposals.set(proposal.id, proposal);
  return ok({
    status: "awaiting_customer_confirmation",
    confirmation_id: proposal.id,
    amount_cents: proposal.amountCents,
    next_step: "Peça ao cliente para confirmar este valor. Não efetive antes da resposta dele.",
  });
}

async function run(session: Session, name: ToolName, rawInput: unknown): Promise<ToolOutcome> {
  switch (name) {
    case "get_order": {
      const { order_id } = schemas.get_order.parse(rawInput);
      const order = await ownOrder(session, order_id);
      return order ? ok({ order }) : notFound(order_id);
    }
    case "get_delivery_status": {
      const { order_id } = schemas.get_delivery_status.parse(rawInput);
      const order = await ownOrder(session, order_id);
      if (!order) return notFound(order_id);
      const delivery = await session.db.getDelivery(order.id);
      return delivery ? ok({ delivery }) : fail("delivery_not_found", "Sem dados de entrega para este pedido.");
    }
    case "request_partial_refund":
      return refund(session, schemas.request_partial_refund.parse(rawInput));
    case "open_human_ticket": {
      const input = schemas.open_human_ticket.parse(rawInput);
      if (input.order_id && !(await ownOrder(session, input.order_id))) return notFound(input.order_id);
      const ticket = await session.db.addTicket({
        customerId: session.customerId,
        orderId: input.order_id ?? null,
        summary: input.summary,
      });
      return ok({ ticket_id: ticket.id, message: "Chamado aberto. Um atendente humano vai assumir o caso." });
    }
  }
}

/** Executa uma ferramenta, valida a entrada e registra a chamada na sessão. */
export async function executeTool(session: Session, name: string, rawInput: unknown): Promise<ToolOutcome> {
  let outcome: ToolOutcome;
  if (!(name in schemas)) {
    outcome = fail("unknown_tool", `Ferramenta desconhecida: ${name}`);
  } else {
    try {
      outcome = await run(session, name as ToolName, rawInput);
    } catch (error) {
      if (error instanceof z.ZodError) {
        outcome = fail("invalid_input", error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      } else {
        throw error;
      }
    }
  }
  session.calls.push({
    turn: session.userTurn,
    name,
    input: rawInput,
    ok: outcome.ok,
    ...(outcome.ok ? {} : { code: String(outcome.data.code) }),
  });
  return outcome;
}
