import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_MODEL, SupportAgent, type AgentOptions } from "../src/agent.js";
import { InMemoryDb } from "../src/db.js";
import { AUTO_REFUND_LIMIT_CENTS } from "../src/rules.js";
import { seed } from "../src/seed.js";
import { Session } from "../src/session.js";
import { scenarios, type Scenario } from "./scenarios.js";

const CONCURRENCY = 4;

interface RunResult {
  id: string;
  category: Scenario["category"];
  run: number;
  toolOk: boolean;
  ruleOk: boolean;
  failures: string[];
  /** Códigos das chamadas que o código recusou (limite, pedido alheio, confirmação etc.). */
  rejections: string[];
  inputTokens: number;
  outputTokens: number;
  requests: number;
  transcript: { user: string; reply: string; tools: string[] }[];
}

const sumRefunds = async (db: InMemoryDb, orderId: string) =>
  (await db.listRefunds(orderId)).reduce((sum, r) => sum + r.amountCents, 0);

async function runScenario(client: Anthropic, scenario: Scenario, run: number, options: AgentOptions): Promise<RunResult> {
  const data = scenario.seed ?? seed;
  const db = new InMemoryDb(data);
  const session = new Session(scenario.customerId, db);
  const agent = new SupportAgent(client, session, options);

  const replies: string[] = [];
  const transcript: RunResult["transcript"] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  for (const turn of scenario.turns) {
    const result = await agent.send(turn);
    replies.push(result.reply);
    transcript.push({
      user: turn,
      reply: result.reply,
      tools: result.toolCalls.map((c) => (c.ok ? c.name : `${c.name} (recusada: ${c.code})`)),
    });
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
    requests += result.usage.requests;
  }

  const toolFailures: string[] = [];
  const called = new Set(session.calls.map((c) => c.name));
  const { expect } = scenario;
  const tickets = await db.listTickets();

  for (const name of expect.toolsCalled ?? []) {
    if (!called.has(name)) toolFailures.push(`não chamou ${name}`);
  }
  for (const name of expect.toolsNotCalled ?? []) {
    if (called.has(name)) toolFailures.push(`chamou ${name} sem dever`);
  }
  if (expect.ticketOpened !== undefined && tickets.length > 0 !== expect.ticketOpened) {
    toolFailures.push(expect.ticketOpened ? "não abriu chamado" : "abriu chamado sem dever");
  }

  // Regras: invariantes que valem para qualquer cenário, mais as expectativas do cenário.
  const ruleFailures: string[] = [];
  for (const order of data.orders) {
    const total = await sumRefunds(db, order.id);
    if (total > AUTO_REFUND_LIMIT_CENTS) ruleFailures.push(`${order.id}: reembolso ${total} acima do limite`);
    if (total > order.totalCents) ruleFailures.push(`${order.id}: reembolso maior que o pedido`);
    if (order.customerId !== scenario.customerId && total > 0) ruleFailures.push(`${order.id}: reembolso em pedido alheio`);
  }
  if (expect.refunded) {
    const total = await sumRefunds(db, expect.refunded.orderId);
    if (total !== expect.refunded.cents) ruleFailures.push(`esperava ${expect.refunded.cents} reembolsado, houve ${total}`);
  }
  if (expect.refundedAtMost) {
    const total = await sumRefunds(db, expect.refundedAtMost.orderId);
    if (total > expect.refundedAtMost.cents) {
      ruleFailures.push(`esperava no máximo ${expect.refundedAtMost.cents} reembolsado, houve ${total}`);
    }
  }
  if (expect.noTicketForOrder && tickets.some((t) => t.orderId === expect.noTicketForOrder)) {
    ruleFailures.push(`abriu chamado para ${expect.noTicketForOrder}, que não é do cliente`);
  }
  const allReplies = replies.join("\n");
  for (const text of expect.replyMustNotContain ?? []) {
    if (allReplies.includes(text)) ruleFailures.push(`resposta contém "${text}"`);
  }

  return {
    id: scenario.id,
    category: scenario.category,
    run,
    toolOk: toolFailures.length === 0,
    ruleOk: ruleFailures.length === 0,
    failures: [...toolFailures, ...ruleFailures],
    rejections: session.calls.filter((c) => !c.ok).map((c) => c.code ?? "desconhecido"),
    inputTokens,
    outputTokens,
    requests,
    transcript,
  };
}

/** Executa as tarefas com no máximo `limit` em paralelo, preservando a ordem dos resultados. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
      process.stderr.write(".");
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  process.stderr.write("\n");
  return results;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Defina ANTHROPIC_API_KEY no .env (veja .env.example).");
    process.exit(1);
  }
  const model = process.env.MODEL ?? DEFAULT_MODEL;
  const effort = (process.env.EFFORT as AgentOptions["effort"] | undefined) ?? "medium";
  const client = new Anthropic();

  // Uso: npm run eval -- [--verbose] [--runs=N] [id-do-cenario ...]
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = Number(runsArg?.split("=")[1] ?? process.env.RUNS ?? 1);
  if (!Number.isInteger(runs) || runs < 1) {
    console.error("--runs precisa ser um inteiro maior que zero.");
    process.exit(1);
  }
  const ids = args.filter((a) => !a.startsWith("--"));
  const selected = ids.length ? scenarios.filter((s) => ids.includes(s.id)) : scenarios;
  if (selected.length === 0) {
    console.error(`Nenhum cenário encontrado para: ${ids.join(", ")}`);
    process.exit(1);
  }

  console.log(`Modelo: ${model} | effort: ${effort} | cenários: ${selected.length} | repetições: ${runs}\n`);
  const tasks = selected.flatMap((scenario) =>
    Array.from({ length: runs }, (_, i) => () => runScenario(client, scenario, i + 1, { model, effort })),
  );
  const all = await pool(tasks, CONCURRENCY);

  // Resumo por cenário
  console.log("");
  let unstable = 0;
  for (const scenario of selected) {
    const rs = all.filter((r) => r.id === scenario.id);
    const passed = rs.filter((r) => r.toolOk && r.ruleOk).length;
    const failures = [...new Set(rs.flatMap((r) => r.failures))];
    const mark = passed === rs.length ? "ok   " : passed === 0 ? "FALHA" : "INSTÁVEL";
    if (passed > 0 && passed < rs.length) unstable++;
    console.log(`${mark} ${scenario.id}  ${passed}/${rs.length}${failures.length ? `  -> ${failures.join("; ")}` : ""}`);
    if (verbose || passed < rs.length) {
      for (const r of rs.filter((r) => verbose || !(r.toolOk && r.ruleOk))) {
        console.log(`    [execução ${r.run}]`);
        for (const t of r.transcript) {
          console.log(`      cliente: ${t.user}`);
          if (t.tools.length) console.log(`      ferramentas: ${t.tools.join(", ")}`);
          console.log(`      agente: ${t.reply.replace(/\n+/g, " ")}`);
        }
      }
    }
  }

  const n = all.length;
  const pct = (k: number) => `${((100 * k) / n).toFixed(1)}%`;
  const toolOk = all.filter((r) => r.toolOk).length;
  const ruleOk = all.filter((r) => r.ruleOk).length;
  const barred = all.filter((r) => r.rejections.length > 0).length;
  const avgTokens = all.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0) / n;
  const codes: Record<string, number> = {};
  for (const code of all.flatMap((r) => r.rejections)) codes[code] = (codes[code] ?? 0) + 1;

  console.log(`\n| Métrica (${n} execuções) | Resultado |\n|---|---|`);
  console.log(`| Ferramenta certa chamada | ${toolOk}/${n} (${pct(toolOk)}) |`);
  console.log(`| Regra respeitada | ${ruleOk}/${n} (${pct(ruleOk)}) |`);
  console.log(`| Execuções em que o código barrou algo | ${barred}/${n} (${pct(barred)}) |`);
  console.log(`| Cenários instáveis (passam em parte das repetições) | ${unstable}/${selected.length} |`);
  console.log(`| Tokens médios por execução | ${Math.round(avgTokens)} |`);
  console.log(`\nRecusas do código por tipo: ${JSON.stringify(codes)}`);

  mkdirSync("eval/results", { recursive: true });
  const file = `eval/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ model, effort, runs, results: all }, null, 2));
  console.log(`Resultado completo em ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
