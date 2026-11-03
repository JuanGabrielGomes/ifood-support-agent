export type OrderStatus = "preparing" | "out_for_delivery" | "delivered" | "cancelled";

export interface OrderItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  restaurant: string;
  items: OrderItem[];
  totalCents: number;
  status: OrderStatus;
  placedAt: string;
  promisedAt: string;
  deliveredAt: string | null;
}

export type DeliveryStatus = "waiting_courier" | "on_the_way" | "delayed" | "delivered" | "failed";

export interface Delivery {
  orderId: string;
  courier: string | null;
  status: DeliveryStatus;
  etaMinutes: number | null;
  lastUpdate: string;
}

export interface Refund {
  id: string;
  orderId: string;
  amountCents: number;
  reason: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  customerId: string;
  orderId: string | null;
  summary: string;
  createdAt: string;
}
