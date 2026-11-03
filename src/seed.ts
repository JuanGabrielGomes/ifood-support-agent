import type { SeedData } from "./db.js";

/** Clientes fictícios: CLI-ANA e CLI-BRUNO. Valores em centavos. */
export const CUSTOMER_ANA = "CLI-ANA";
export const CUSTOMER_BRUNO = "CLI-BRUNO";

export const seed: SeedData = {
  orders: [
    {
      id: "PED-1001",
      customerId: CUSTOMER_ANA,
      restaurant: "Cantina Bella",
      items: [
        { name: "Lasanha à bolonhesa", quantity: 2, unitPriceCents: 3900 },
        { name: "Refrigerante 2L", quantity: 1, unitPriceCents: 1100 },
      ],
      totalCents: 8900,
      status: "delivered",
      placedAt: "2026-11-02T19:10:00-03:00",
      promisedAt: "2026-11-02T19:55:00-03:00",
      deliveredAt: "2026-11-02T21:05:00-03:00",
    },
    {
      id: "PED-1002",
      customerId: CUSTOMER_ANA,
      restaurant: "Burger Norte",
      items: [{ name: "Combo duplo", quantity: 1, unitPriceCents: 4200 }],
      totalCents: 4200,
      status: "out_for_delivery",
      placedAt: "2026-11-03T12:30:00-03:00",
      promisedAt: "2026-11-03T13:10:00-03:00",
      deliveredAt: null,
    },
    {
      id: "PED-1003",
      customerId: CUSTOMER_ANA,
      restaurant: "Sushi Kame",
      items: [
        { name: "Combo 20 peças", quantity: 1, unitPriceCents: 6800 },
        { name: "Temaki salmão", quantity: 1, unitPriceCents: 2400 },
      ],
      totalCents: 9200,
      status: "delivered",
      placedAt: "2026-11-01T20:00:00-03:00",
      promisedAt: "2026-11-01T20:45:00-03:00",
      deliveredAt: "2026-11-01T20:50:00-03:00",
    },
    {
      id: "PED-1004",
      customerId: CUSTOMER_ANA,
      restaurant: "Padaria Central",
      items: [{ name: "Cesta café da manhã", quantity: 1, unitPriceCents: 3500 }],
      totalCents: 3500,
      status: "cancelled",
      placedAt: "2026-10-30T07:00:00-03:00",
      promisedAt: "2026-10-30T07:40:00-03:00",
      deliveredAt: null,
    },
    {
      id: "PED-2001",
      customerId: CUSTOMER_BRUNO,
      restaurant: "Pizzaria Forno",
      items: [{ name: "Pizza grande", quantity: 1, unitPriceCents: 5400 }],
      totalCents: 5400,
      status: "delivered",
      placedAt: "2026-11-02T20:00:00-03:00",
      promisedAt: "2026-11-02T20:40:00-03:00",
      deliveredAt: "2026-11-02T20:38:00-03:00",
    },
  ],
  deliveries: [
    { orderId: "PED-1001", courier: "Marcos", status: "delivered", etaMinutes: null, lastUpdate: "2026-11-02T21:05:00-03:00" },
    { orderId: "PED-1002", courier: "Rita", status: "delayed", etaMinutes: 25, lastUpdate: "2026-11-03T13:02:00-03:00" },
    { orderId: "PED-1003", courier: "Paulo", status: "delivered", etaMinutes: null, lastUpdate: "2026-11-01T20:50:00-03:00" },
    { orderId: "PED-1004", courier: null, status: "failed", etaMinutes: null, lastUpdate: "2026-10-30T07:20:00-03:00" },
    { orderId: "PED-2001", courier: "Léo", status: "delivered", etaMinutes: null, lastUpdate: "2026-11-02T20:38:00-03:00" },
  ],
};
