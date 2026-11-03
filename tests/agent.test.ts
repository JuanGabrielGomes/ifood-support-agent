import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SupportAgent, type MessagesClient } from "../src/agent.js";
import { InMemoryDb } from "../src/db.js";
import { CUSTOMER_ANA, seed } from "../src/seed.js";
import { Session } from "../src/session.js";

const usage = { input_tokens: 100, output_tokens: 20 } as Anthropic.Usage;

function message(content: Anthropic.ContentBlock[], stop_reason: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return { id: "msg_fake", type: "message", role: "assistant", model: "fake", content, stop_reason, stop_sequence: null, usage } as Anthropic.Message;
}

/** Cliente falso que devolve respostas roteirizadas e guarda as requisições. */
function scripted(responses: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      async create(params) {
        requests.push(structuredClone(params));
        const next = responses.shift();
        if (!next) throw new Error("sem resposta roteirizada");
        return next;
      },
    },
  };
  return { client, requests };
}

describe("SupportAgent", () => {
  it("executa a ferramenta pedida e devolve o resultado ao modelo", async () => {
    const { client, requests } = scripted([
      message([{ type: "tool_use", id: "tu_1", name: "get_order", input: { order_id: "PED-1001" } } as Anthropic.ToolUseBlock], "tool_use"),
      message([{ type: "text", text: "Seu pedido foi entregue.", citations: null } as Anthropic.TextBlock], "end_turn"),
    ]);
    const session = new Session(CUSTOMER_ANA, new InMemoryDb(seed));
    const result = await new SupportAgent(client, session).send("Cadê meu pedido PED-1001?");

    expect(result.reply).toBe("Seu pedido foi entregue.");
    expect(result.toolCalls.map((c) => c.name)).toEqual(["get_order"]);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40, requests: 2 });

    const toolResult = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(toolResult[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });

  it("marca erro de regra como is_error para o modelo", async () => {
    const { client, requests } = scripted([
      message(
        [{ type: "tool_use", id: "tu_1", name: "request_partial_refund", input: { order_id: "PED-1001", amount_cents: 9000, reason: "tudo" } } as Anthropic.ToolUseBlock],
        "tool_use",
      ),
      message([{ type: "text", text: "Não consigo, vou abrir um chamado.", citations: null } as Anthropic.TextBlock], "end_turn"),
    ]);
    const session = new Session(CUSTOMER_ANA, new InMemoryDb(seed));
    await new SupportAgent(client, session).send("Quero R$ 90 de volta");

    const toolResult = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(toolResult[0]!.is_error).toBe(true);
    expect(session.rejections).toBe(1);
  });

  it("para ao atingir maxIterations", async () => {
    const loop = () =>
      message([{ type: "tool_use", id: "tu", name: "get_order", input: { order_id: "PED-1001" } } as Anthropic.ToolUseBlock], "tool_use");
    const { client } = scripted([loop(), loop(), loop()]);
    const session = new Session(CUSTOMER_ANA, new InMemoryDb(seed));
    const result = await new SupportAgent(client, session, { maxIterations: 3 }).send("oi");
    expect(result.usage.requests).toBe(3);
    expect(result.stopReason).toBe("tool_use");
  });
});
