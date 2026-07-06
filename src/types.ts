export type BusinessId = "scds" | "graphics";
export type BusinessScope = BusinessId | "combined";
export type PaymentMethod = "M-Pesa" | "Cash" | "Bank Transfer";
export type PaymentStatus = "Paid" | "Partial" | "Pending";
export type PayerType = "student" | "client";
export type UserRole = "admin" | "staff";

export type Business = {
  id: BusinessId;
  name: string;
  shortName: string;
  tagline?: string;
  primary: string;
  accent: string;
  success: string;
  alert: string;
  light: string;
};

export type Payer = {
  id: string;
  businessId: BusinessId;
  fullName: string;
  phone: string;
  email: string;
  type: PayerType;
  createdAt: string;
};

export type Item = {
  id: string;
  businessId: BusinessId;
  payerId: string;
  title: string;
  totalAmount: number;
  dueDate: string;
  installmentCount: number;
  installmentAmount: number;
  installmentFrequency: "once" | "weekly" | "monthly";
  balanceClosed?: boolean;
  balanceClosedAt?: string;
  balanceClosedReason?: string;
  createdAt: string;
};

export type Payment = {
  id: string;
  businessId: BusinessId;
  payerId: string;
  itemId: string;
  amount: number;
  method: PaymentMethod;
  mpesaCode?: string;
  date: string;
  status: PaymentStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt?: string;
  edited: boolean;
};

export type AuditEntry = {
  id: string;
  paymentId: string;
  action: "created" | "edited" | "deleted" | "restored";
  changedFields: string[];
  previousValues: Record<string, unknown>;
  changedAt: string;
  changedBy: string;
};

export type EnrichedPayment = Payment & {
  payerName: string;
  payerPhone: string;
  payerEmail: string;
  itemTitle: string;
  businessName: string;
  balance: number;
  dueDate: string;
  totalAmount: number;
};

export type AppData = {
  payers: Payer[];
  items: Item[];
  payments: Payment[];
  auditLog: AuditEntry[];
  roles: Record<string, UserRole>;
};

export type StorageBackend = "supabase" | "browser";
