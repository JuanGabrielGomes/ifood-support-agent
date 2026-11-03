import type { Delivery, Order, Refund, Ticket } from "./types.js";

/**
 * Contrato de acesso a dados. A implementação em memória serve aos testes e à
 * avaliação; um adaptador Supabase/Postgres pode implementar a mesma interface.
 */
export interface Db {
  getOrder(orderId: string): Promise<Order | null>;
  getDelivery(orderId: string): Promise<Delivery | null>;
  listRefunds(orderId: string): Promise<Refund[]>;
  addRefund(input: Omit<Refund, "id" | "createdAt">): Promise<Refund>;
  addTicket(input: Omit<Ticket, "id" | "createdAt">): Promise<Ticket>;
  listTickets(): Promise<Ticket[]>;
}

export interface SeedData {
  orders: Order[];
  deliveries: Delivery[];
}

export class InMemoryDb implements Db {
  private orders: Map<string, Order>;
  private deliveries: Map<string, Delivery>;
  private refunds: Refund[] = [];
  private tickets: Ticket[] = [];

  constructor(seed: SeedData) {
    const data = structuredClone(seed);
    this.orders = new Map(data.orders.map((o) => [o.id, o]));
    this.deliveries = new Map(data.deliveries.map((d) => [d.orderId, d]));
  }

  async getOrder(orderId: string) {
    return structuredClone(this.orders.get(orderId) ?? null);
  }

  async getDelivery(orderId: string) {
    return structuredClone(this.deliveries.get(orderId) ?? null);
  }

  async listRefunds(orderId: string) {
    return structuredClone(this.refunds.filter((r) => r.orderId === orderId));
  }

  async addRefund(input: Omit<Refund, "id" | "createdAt">) {
    const refund: Refund = {
      ...input,
      id: `REF-${String(this.refunds.length + 1).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
    };
    this.refunds.push(refund);
    return structuredClone(refund);
  }

  async addTicket(input: Omit<Ticket, "id" | "createdAt">) {
    const ticket: Ticket = {
      ...input,
      id: `TKT-${String(this.tickets.length + 1).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
    };
    this.tickets.push(ticket);
    return structuredClone(ticket);
  }

  async listTickets() {
    return structuredClone(this.tickets);
  }
}
