import type { Db } from "./db.js";
import { MAX_REJECTIONS_BEFORE_ESCALATION } from "./rules.js";

export interface RefundProposal {
  id: string;
  orderId: string;
  amountCents: number;
  reason: string;
  /** Número do turno do cliente em que a proposta foi criada. */
  turn: number;
}

export interface ToolCallRecord {
  turn: number;
  name: string;
  input: unknown;
  ok: boolean;
  /** Código de erro/violação quando `ok` é falso. */
  code?: string;
}

/**
 * Estado de uma conversa. Vive no código, não no prompt: é aqui que ficam os
 * contadores que sustentam as regras de confirmação e escalonamento.
 */
export class Session {
  /** Quantas mensagens do cliente já chegaram. */
  userTurn = 0;
  rejections = 0;
  readonly proposals = new Map<string, RefundProposal>();
  readonly calls: ToolCallRecord[] = [];
  private proposalSeq = 0;

  constructor(
    readonly customerId: string,
    readonly db: Db,
  ) {}

  get mustEscalate() {
    return this.rejections >= MAX_REJECTIONS_BEFORE_ESCALATION;
  }

  nextProposalId() {
    this.proposalSeq += 1;
    return `PROP-${this.proposalSeq}`;
  }
}
