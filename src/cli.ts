import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DEFAULT_MODEL, SupportAgent } from "./agent.js";
import { InMemoryDb } from "./db.js";
import { CUSTOMER_ANA, seed } from "./seed.js";
import { Session } from "./session.js";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Defina ANTHROPIC_API_KEY no .env (veja .env.example).");
    process.exit(1);
  }
  const session = new Session(CUSTOMER_ANA, new InMemoryDb(seed));
  const agent = new SupportAgent(new Anthropic(), session, { model: process.env.MODEL ?? DEFAULT_MODEL });
  const rl = createInterface({ input, output });

  console.log("Suporte a pedidos (cliente Ana). Digite 'sair' para encerrar.\n");
  while (true) {
    const text = (await rl.question("Você: ")).trim();
    if (!text) continue;
    if (text === "sair") break;
    const result = await agent.send(text);
    for (const call of result.toolCalls) console.log(`  [ferramenta] ${call.name}${call.ok ? "" : ` (recusada: ${call.code})`}`);
    console.log(`\nAgente: ${result.reply}\n`);
  }
  rl.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
