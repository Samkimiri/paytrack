import { createContext, FormEvent, Suspense, lazy, useContext, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArchiveRestore,
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Coins,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  FileText,
  Home,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Pencil,
  Plus,
  Printer,
  ReceiptText,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import { businesses } from "./data";
import { defaultAppData, loadAppData, saveAppData } from "./storage";
import type {
  AuditEntry,
  BusinessId,
  BusinessScope,
  EnrichedPayment,
  Item,
  Payer,
  Payment,
  PaymentMethod,
  PaymentStatus,
  StorageBackend,
} from "./types";

const money = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat("en-KE", {
  month: "short",
  day: "2-digit",
  year: "numeric",
});

type TrendPoint = { month: string; income: number };
type DateRangeFilter = "all" | "today" | "week" | "month" | "custom";
type MoneyPrivacyContextValue = {
  totalsVisible: boolean;
  formatMoney: (value: number) => string;
};

const hiddenMoneyText = "KES *****";
const MoneyPrivacyContext = createContext<MoneyPrivacyContextValue>({
  totalsVisible: true,
  formatMoney: (value) => money.format(value),
});

function useMoneyPrivacy() {
  return useContext(MoneyPrivacyContext);
}

function MoneyAmount({
  value,
  className,
  style,
  compact = false,
}: {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
}) {
  const { totalsVisible, formatMoney } = useMoneyPrivacy();
  const display = compact && totalsVisible ? money.format(Math.max(value, 0)).replace("KES", "").trim() : formatMoney(value);

  return <span className={className} style={style}>{display}</span>;
}

const IncomeTrendChart = lazy(async () => {
  const { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } = await import("recharts");

  return {
    default: function IncomeTrendChartView({
      trend,
      accent,
    }: {
      trend: TrendPoint[];
      accent: string;
    }) {
      const { totalsVisible, formatMoney } = useMoneyPrivacy();

      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="incomeFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="5%" stopColor={accent} stopOpacity={0.26} />
                <stop offset="95%" stopColor={accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E4E7EC" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(value) => (totalsVisible ? `${Number(value) / 1000}k` : "•••")} tickLine={false} axisLine={false} width={48} />
            <Tooltip formatter={(value) => formatMoney(Number(value))} />
            <Area type="monotone" dataKey="income" stroke={accent} fill="url(#incomeFill)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      );
    },
  };
});

type PaymentNotificationDetails = {
  payer: Payer;
  item: Item;
  payment: Payment;
};

function normalizeWhatsAppPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}

function normalizeSmsPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  return phone.trim().startsWith("+") ? phone.trim() : `+${digits}`;
}

function canMessagePhone(phone: string) {
  return Boolean(normalizeWhatsAppPhone(phone) || normalizeSmsPhone(phone));
}

function openContactMessage(phone: string, message: string) {
  const whatsappPhone = normalizeWhatsAppPhone(phone);

  if (whatsappPhone) {
    window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    return;
  }

  const smsPhone = normalizeSmsPhone(phone);
  if (smsPhone) {
    window.open(`sms:${smsPhone}?&body=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
}

function openSmsMessage(phone: string, message: string) {
  const smsPhone = normalizeSmsPhone(phone);
  if (smsPhone) {
    window.open(`sms:${smsPhone}?&body=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }
}

function buildPaymentMessage({ payer, item, payment }: PaymentNotificationDetails) {
  const business = businesses[payment.businessId];
  const balance = Math.max(item.totalAmount - payment.amount, 0);
  const lines: Array<string | null> = [
    `Hello ${payer.fullName},`,
    "",
    `Thank you for trusting ${business.name} with ${item.title}. We are pleased to confirm that your payment of ${money.format(payment.amount)} has been received.`,
    "",
    "Payment summary:",
    `- Amount received: ${money.format(payment.amount)}`,
    `- Service/project: ${item.title}`,
    `- Payment method: ${payment.method}`,
    payment.mpesaCode ? `- M-Pesa code: ${payment.mpesaCode}` : null,
    `- Payment date: ${payment.date}`,
    `- Remaining balance: ${money.format(balance)}`,
    "",
    "We genuinely appreciate the opportunity to work with you. If you need more creative support, training, design work, or a follow-up service, we would be glad to help again and continue building on the work we have done together.",
    "",
    `Warm regards,`,
    `${business.name}`,
  ];

  return lines.filter((line) => line !== null).join("\n");
}

function openPaymentNotifications(details: PaymentNotificationDetails) {
  openContactMessage(details.payer.phone, buildPaymentMessage(details));
}

function buildReceiptShareMessage(payment: EnrichedPayment) {
  const business = businesses[payment.businessId];

  return [
    `Hello ${payment.payerName},`,
    "",
    `Thank you. This is your payment receipt summary from ${business.name}.`,
    "",
    "Receipt summary:",
    `- Amount received: ${money.format(payment.amount)}`,
    `- Service/project: ${payment.itemTitle}`,
    `- Payment method: ${payment.method}`,
    payment.mpesaCode ? `- M-Pesa code: ${payment.mpesaCode}` : null,
    `- Payment date: ${payment.date}`,
    `- Remaining balance: ${money.format(payment.balance)}`,
    "",
    "Please keep this message for your records. If anything needs correction, kindly let us know.",
    "",
    "Warm regards,",
    business.name,
  ].filter((line) => line !== null).join("\n");
}

function openReceiptShare(payment: EnrichedPayment) {
  openContactMessage(payment.payerPhone, buildReceiptShareMessage(payment));
}

function openReceiptSms(payment: EnrichedPayment) {
  openSmsMessage(payment.payerPhone, buildReceiptShareMessage(payment));
}

function buildBalanceReminderMessage(item: FollowUpItem) {
  const business = businesses[item.businessId];
  const timing = item.daysUntilDue < 0
    ? `overdue by ${Math.abs(item.daysUntilDue)} day${Math.abs(item.daysUntilDue) === 1 ? "" : "s"}`
    : `due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"}`;
  const dueDate = dateFmt.format(new Date(item.dueDate));

  return [
    `Hello ${item.payerName},`,
    "",
    `I hope you are doing well. This is a polite reminder from ${business.name} about the remaining balance of ${money.format(item.balance)} for ${item.itemTitle}.`,
    `The balance was due on ${dueDate} and is currently ${timing}. Kindly complete the balance at your earliest convenience so we can close your account record smoothly.`,
    `You can pay via Buy Goods & Services Till: ${balanceTillNumber}.`,
    "",
    "Please let us know once you have completed the payment, or if you would like us to confirm any payment details.",
    "",
    "Warm regards,",
    business.name,
  ].join("\n");
}

function openWhatsAppReminder(item: FollowUpItem) {
  openContactMessage(item.phone, buildBalanceReminderMessage(item));
}

function openSmsReminder(item: FollowUpItem) {
  openSmsMessage(item.phone, buildBalanceReminderMessage(item));
}

function reminderFromPayment(payment: EnrichedPayment): FollowUpItem {
  const due = new Date(`${payment.dueDate}T00:00:00`);
  const current = new Date(`${today}T00:00:00`);
  const daysUntilDue = Math.ceil((due.getTime() - current.getTime()) / 86_400_000);

  return {
    id: payment.itemId,
    businessId: payment.businessId,
    payerName: payment.payerName,
    phone: payment.payerPhone,
    email: payment.payerEmail,
    itemTitle: payment.itemTitle,
    dueDate: payment.dueDate,
    balance: payment.balance,
    daysUntilDue,
    status: daysUntilDue < 0 ? "overdue" : daysUntilDue <= 14 ? "due-soon" : "scheduled",
    lastPaymentDate: payment.date,
  };
}

const nav = [
  { id: "home", label: "Home", icon: Home },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "payments", label: "Payments", icon: ReceiptText },
  { id: "overdue", label: "Overdue", icon: AlertTriangle },
  { id: "payers", label: "Clients/Students", icon: UsersRound },
  { id: "add", label: "Add Payment", icon: Plus },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "trash", label: "Trash", icon: ArchiveRestore },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type View = (typeof nav)[number]["id"];

type ConfidenceSeverity = "critical" | "warning" | "notice";

type ConfidenceIssue = {
  id: string;
  title: string;
  detail: string;
  severity: ConfidenceSeverity;
  paymentId?: string;
  itemId?: string;
  payerName?: string;
};

type ConfidenceLedger = {
  score: number;
  cleanCount: number;
  issueCount: number;
  issues: ConfidenceIssue[];
  byPaymentId: Record<string, ConfidenceIssue[]>;
};

type FollowUpStatus = "overdue" | "due-soon" | "scheduled";

type FollowUpItem = {
  id: string;
  businessId: BusinessId;
  payerName: string;
  phone: string;
  email: string;
  itemTitle: string;
  dueDate: string;
  balance: number;
  daysUntilDue: number;
  status: FollowUpStatus;
  lastPaymentDate?: string;
};

type FollowUpLedger = {
  items: FollowUpItem[];
  overdueTotal: number;
  dueSoonTotal: number;
  scheduledTotal: number;
  priorityCount: number;
};

type FormState = {
  businessId: BusinessId;
  payerId: string;
  newPayerName: string;
  newPayerPhone: string;
  newPayerEmail: string;
  itemTitle: string;
  totalDue: string;
  installmentCount: string;
  installmentFrequency: "once" | "weekly" | "monthly";
  amount: string;
  method: PaymentMethod;
  mpesaCode: string;
  date: string;
  dueDate: string;
  notes: string;
};

type EditPaymentContext = {
  payment: EnrichedPayment;
  item: Item;
  otherPaidForItem: number;
};

const today = new Date().toISOString().slice(0, 10);
const trashRetentionDays = 30;
const balanceTillNumber = "9322260";

function App() {
  const [scope, setScope] = useState<BusinessScope>("combined");
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get("action") === "add-payment" ? "add" : "home",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [payers, setPayers] = useState<Payer[]>(defaultAppData.payers);
  const [items, setItems] = useState<Item[]>(defaultAppData.items);
  const [payments, setPayments] = useState<Payment[]>(defaultAppData.payments);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(defaultAppData.auditLog);
  const [roles, setRoles] = useState(defaultAppData.roles);
  const [hydrated, setHydrated] = useState(false);
  const [storageBackend, setStorageBackend] = useState<StorageBackend>("browser");
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | PaymentMethod>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [dateRange, setDateRange] = useState<DateRangeFilter>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [totalsVisible, setTotalsVisible] = useState(false);
  const moneyPrivacy = useMemo(
    () => ({
      totalsVisible,
      formatMoney: (value: number) => (totalsVisible ? money.format(value) : hiddenMoneyText),
    }),
    [totalsVisible],
  );

  useEffect(() => {
    if (!totalsVisible) return undefined;
    const timeoutId = window.setTimeout(() => setTotalsVisible(false), 120_000);
    return () => window.clearTimeout(timeoutId);
  }, [totalsVisible]);

  const activeBrand = scope === "graphics" ? businesses.graphics : businesses.scds;
  const visibleBusinessIds = useMemo<BusinessId[]>(
    () => (scope === "combined" ? ["scds", "graphics"] : [scope]),
    [scope],
  );

  const enrichedPayments = useMemo(
    () =>
      payments.map((payment) => {
        const payer = payers.find((entry) => entry.id === payment.payerId);
        const item = items.find((entry) => entry.id === payment.itemId);
        const activePaid = payments
          .filter((entry) => entry.itemId === payment.itemId && !entry.isDeleted)
          .reduce((sum, entry) => sum + entry.amount, 0);
        const itemTotal = isCollectibleItem(item, payments) ? (item?.totalAmount ?? 0) : activePaid;
        return {
          ...payment,
          payerName: payer?.fullName ?? "Unknown payer",
          payerPhone: payer?.phone ?? "",
          payerEmail: payer?.email ?? "",
          itemTitle: item?.title ?? "Unassigned item",
          businessName: businesses[payment.businessId].shortName,
          balance: Math.max(itemTotal - activePaid, 0),
          dueDate: item?.dueDate ?? payment.date,
          totalAmount: item?.totalAmount ?? payment.amount,
        };
      }),
    [items, payers, payments],
  );

  const scopedPayments = useMemo(
    () =>
      enrichedPayments
        .filter((payment) => visibleBusinessIds.includes(payment.businessId))
        .filter((payment) => !payment.isDeleted)
        .filter((payment) => {
          const haystack = `${payment.payerName} ${payment.payerPhone} ${payment.payerEmail} ${payment.itemTitle} ${payment.mpesaCode ?? ""}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        })
        .filter((payment) => isPaymentInDateRange(payment.date, dateRange, customFrom, customTo))
        .filter((payment) => (methodFilter === "all" ? true : payment.method === methodFilter))
        .filter((payment) => (statusFilter === "all" ? true : payment.status === statusFilter))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [customFrom, customTo, dateRange, enrichedPayments, methodFilter, query, statusFilter, visibleBusinessIds],
  );
  const trashPayments = useMemo(
    () =>
      enrichedPayments
        .filter((payment) => visibleBusinessIds.includes(payment.businessId))
        .filter((payment) => payment.isDeleted)
        .sort((a, b) => (b.deletedAt ?? b.updatedAt).localeCompare(a.deletedAt ?? a.updatedAt)),
    [enrichedPayments, visibleBusinessIds],
  );

  const scopedPayers = payers.filter((payer) => visibleBusinessIds.includes(payer.businessId));
  const activePayments = scopedPayments;
  const totalCollected = activePayments.reduce((sum, payment) => sum + payment.amount, 0);
  const weeklyEarnings = enrichedPayments
    .filter((payment) => visibleBusinessIds.includes(payment.businessId))
    .filter((payment) => !payment.isDeleted)
    .filter((payment) => isPaymentInDateRange(payment.date, "week", "", ""))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const outstanding = items
    .filter((item) => visibleBusinessIds.includes(item.businessId))
    .filter((item) => isCollectibleItem(item, payments))
    .reduce((sum, item) => {
      const paid = payments
        .filter((payment) => payment.itemId === item.id && !payment.isDeleted)
        .reduce((innerSum, payment) => innerSum + payment.amount, 0);
      return sum + Math.max(item.totalAmount - paid, 0);
    }, 0);

  const trend = buildTrend(activePayments);
  const selectedPayer = selectedPayerId ? payers.find((payer) => payer.id === selectedPayerId) : null;
  const editingPayment = editingPaymentId ? enrichedPayments.find((payment) => payment.id === editingPaymentId) : undefined;
  const editingItem = editingPayment ? items.find((item) => item.id === editingPayment.itemId) : undefined;
  const editContext = editingPayment && editingItem
    ? {
        payment: editingPayment,
        item: editingItem,
        otherPaidForItem: payments
          .filter((payment) => payment.itemId === editingPayment.itemId && payment.id !== editingPayment.id && !payment.isDeleted)
          .reduce((sum, payment) => sum + payment.amount, 0),
      }
    : undefined;
  const confidenceLedger = useMemo(
    () => buildConfidenceLedger(enrichedPayments, items, auditLog, visibleBusinessIds, moneyPrivacy.formatMoney),
    [auditLog, enrichedPayments, items, visibleBusinessIds, moneyPrivacy],
  );
  const followUpLedger = useMemo(
    () => buildFollowUpLedger(items, payers, payments, visibleBusinessIds),
    [items, payers, payments, visibleBusinessIds],
  );

  useEffect(() => {
    let active = true;

    loadAppData().then(({ data, backend, error }) => {
      if (!active) return;
      setPayers(data.payers);
      setItems(data.items);
      setPayments(data.payments);
      setAuditLog(data.auditLog);
      setRoles(data.roles);
      setStorageBackend(backend);
      setStorageError(error ?? null);
      setSaveState(error ? "error" : "saved");
      setHydrated(true);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const handle = window.setTimeout(() => {
      setSaveState("saving");
      saveAppData({ payers, items, payments, auditLog, roles }).then(({ backend, error, savedAt }) => {
        setStorageBackend(backend);
        setStorageError(error ?? null);
        setLastSavedAt(savedAt);
        setSaveState(error ? "error" : "saved");
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [auditLog, hydrated, items, payers, payments, roles]);

  function recordAudit(paymentId: string, action: AuditEntry["action"], changedFields: string[], previousValues = {}) {
    setAuditLog((current) => [
      {
        id: crypto.randomUUID(),
        paymentId,
        action,
        changedFields,
        previousValues,
        changedAt: new Date().toISOString(),
        changedBy: "admin",
      },
      ...current,
    ]);
  }

  function updatePayer(payerId: string, updates: Pick<Payer, "fullName" | "phone" | "email" | "type">) {
    setPayers((current) =>
      current.map((payer) =>
        payer.id === payerId
          ? {
              ...payer,
              fullName: updates.fullName.trim(),
              phone: updates.phone.trim(),
              email: updates.email.trim(),
              type: updates.type,
            }
          : payer,
      ),
    );
  }

  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const state = Object.fromEntries(formData.entries()) as Record<string, string>;
    const businessId = state.businessId as BusinessId;
    let payerId = state.payerId;
    const amount = Number(state.amount);
    const totalDue = Number(state.totalDue);
    const installmentCount = Math.max(Number(state.installmentCount || 1), 1);
    let notificationPayer = payers.find((payer) => payer.id === payerId);

    if (state.newPayerName.trim()) {
      payerId = crypto.randomUUID();
      const newPayer: Payer = {
        id: payerId,
        businessId,
        fullName: state.newPayerName.trim(),
        phone: state.newPayerPhone.trim(),
        email: state.newPayerEmail.trim(),
        type: businessId === "scds" ? "student" : "client",
        createdAt: new Date().toISOString(),
      };
      notificationPayer = newPayer;
      setPayers((current) => [
        ...current,
        newPayer,
      ]);
    }

    if (!payerId || !notificationPayer) {
      return;
    }

    const itemId = crypto.randomUUID();
    const newItem: Item = {
      id: itemId,
      businessId,
      payerId,
      title: state.itemTitle,
      totalAmount: totalDue,
      dueDate: state.dueDate || today,
      installmentCount,
      installmentAmount: Math.ceil(totalDue / installmentCount),
      installmentFrequency: state.installmentFrequency as Item["installmentFrequency"],
      balanceClosed: false,
      createdAt: new Date().toISOString(),
    };
    const paidForItem = payments
      .filter((payment) => payment.itemId === itemId && !payment.isDeleted)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const status: PaymentStatus = totalDue - paidForItem - amount <= 0 ? "Paid" : amount > 0 ? "Partial" : "Pending";
    const newPayment: Payment = {
      id: crypto.randomUUID(),
      businessId,
      payerId,
      itemId,
      amount,
      method: state.method as PaymentMethod,
      mpesaCode: state.method === "M-Pesa" ? state.mpesaCode : undefined,
      date: state.date || today,
      status,
      notes: state.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
      edited: false,
    };

    setItems((current) => [...current, newItem]);
    setPayments((current) => [newPayment, ...current]);
    recordAudit(newPayment.id, "created", ["amount", "method", "status"]);
    if (notificationPayer) {
      openPaymentNotifications({ payer: notificationPayer, item: newItem, payment: newPayment });
    }
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1800);
    event.currentTarget.reset();
  }

  function editPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editContext) return;

    const { payment: currentPayment, item: currentItem, otherPaidForItem } = editContext;
    const formData = new FormData(event.currentTarget);
    const state = Object.fromEntries(formData.entries()) as Record<string, string>;
    const amount = Number(state.amount);
    const totalDue = Number(state.totalDue);
    const installmentCount = Math.max(Number(state.installmentCount || 1), 1);
    const method = state.method as PaymentMethod;
    const mpesaCode = method === "M-Pesa" ? state.mpesaCode.trim() : "";
    const paymentDate = state.date || today;
    const dueDate = state.dueDate || today;
    const status: PaymentStatus = totalDue - otherPaidForItem - amount <= 0 ? "Paid" : amount > 0 ? "Partial" : "Pending";
    const shouldReopenBalance = currentItem.balanceClosed && totalDue - otherPaidForItem - amount > 0;
    const previousValues: Record<string, unknown> = {};
    const changedFields: string[] = [];
    const trackChange = (field: string, previous: unknown, next: unknown) => {
      if (previous !== next) {
        changedFields.push(field);
        previousValues[field] = previous;
      }
    };

    trackChange("amount", currentPayment.amount, amount);
    trackChange("method", currentPayment.method, method);
    trackChange("mpesa_code", currentPayment.mpesaCode ?? "", mpesaCode);
    trackChange("date", currentPayment.date, paymentDate);
    trackChange("status", currentPayment.status, status);
    trackChange("notes", currentPayment.notes, state.notes);
    trackChange("item_title", currentItem.title, state.itemTitle);
    trackChange("total_due", currentItem.totalAmount, totalDue);
    trackChange("due_date", currentItem.dueDate, dueDate);
    trackChange("installment_count", currentItem.installmentCount, installmentCount);
    trackChange("installment_frequency", currentItem.installmentFrequency, state.installmentFrequency);
    if (shouldReopenBalance) {
      trackChange("balance_closed", currentItem.balanceClosed, false);
    }

    if (!changedFields.length) {
      setEditingPaymentId(null);
      setView("payments");
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.id === currentItem.id
          ? {
              ...item,
              title: state.itemTitle,
              totalAmount: totalDue,
              dueDate,
              installmentCount,
              installmentAmount: Math.ceil(totalDue / installmentCount),
              installmentFrequency: state.installmentFrequency as Item["installmentFrequency"],
              balanceClosed: shouldReopenBalance ? false : item.balanceClosed,
              balanceClosedAt: shouldReopenBalance ? undefined : item.balanceClosedAt,
              balanceClosedReason: shouldReopenBalance ? undefined : item.balanceClosedReason,
            }
          : item,
      ),
    );
    setPayments((current) =>
      current.map((payment) =>
        payment.id === currentPayment.id
          ? {
              ...payment,
              amount,
              method,
              mpesaCode: method === "M-Pesa" ? mpesaCode : undefined,
              date: paymentDate,
              status,
              notes: state.notes,
              updatedAt: new Date().toISOString(),
              edited: true,
            }
          : payment,
      ),
    );

    if (changedFields.length) {
      recordAudit(currentPayment.id, "edited", changedFields, previousValues);
    }
    setEditingPaymentId(null);
    setView("payments");
  }

  function startEditingPayment(payment: EnrichedPayment) {
    setEditingPaymentId(payment.id);
    setView("add");
  }

  function cancelEditingPayment() {
    setEditingPaymentId(null);
    setView("payments");
  }

  function softDelete(payment: Payment) {
    const activePaymentsForItem = payments.filter((entry) => entry.itemId === payment.itemId && entry.id !== payment.id && !entry.isDeleted);
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    if (!activePaymentsForItem.length) {
      closeItemBalance(payment.itemId, "Closed after deleting the payment record");
    }
    recordAudit(payment.id, "deleted", ["is_deleted", "deleted_at"], { is_deleted: false, deleted_at: payment.deletedAt });
  }

  function closeItemBalance(itemId: string, reason = "Balance closed manually") {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              balanceClosed: true,
              balanceClosedAt: new Date().toISOString(),
              balanceClosedReason: reason,
            }
          : item,
      ),
    );
  }

  function restorePayment(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: false, deletedAt: undefined, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    setItems((current) =>
      current.map((item) =>
        item.id === payment.itemId && item.balanceClosed
          ? { ...item, balanceClosed: false, balanceClosedAt: undefined, balanceClosedReason: undefined }
          : item,
      ),
    );
    recordAudit(payment.id, "restored", ["is_deleted", "deleted_at"], { is_deleted: true, deleted_at: payment.deletedAt });
  }

  async function printReceipt(payment: EnrichedPayment) {
    const { default: jsPDF } = await import("jspdf");
    const brand = businesses[payment.businessId];
    const doc = new jsPDF();
    doc.setFillColor(brand.primary);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor("#ffffff");
    doc.setFontSize(17);
    doc.text(brand.name, 18, 18);
    doc.setFontSize(10);
    doc.text(brand.tagline ?? "Professional payment receipt", 18, 26);
    doc.setTextColor(brand.primary);
    doc.setFontSize(22);
    doc.text("Payment Receipt", 18, 52);
    doc.setFontSize(11);
    const receiptDoc = doc as unknown as { splitTextToSize: (text: string, maxWidth: number) => string[] };
    const rows = [
      ["Receipt ID", payment.id],
      ["Date", dateFmt.format(new Date(payment.date))],
      ["Payer", payment.payerName],
      ["Item", payment.itemTitle],
      ["Amount", money.format(payment.amount)],
      ["Method", payment.method],
      ["M-Pesa Code", payment.mpesaCode ?? "N/A"],
      ["Status", payment.balance === 0 ? "PAID" : "BALANCE DUE"],
      ["Remaining Balance", money.format(payment.balance)],
    ];
    let y = 70;
    rows.forEach(([label, value]) => {
      const wrappedValue = receiptDoc.splitTextToSize(String(value), 112);
      doc.setTextColor("#667085");
      doc.text(label, 18, y);
      doc.setTextColor("#172033");
      wrappedValue.forEach((line, lineIndex) => {
        doc.text(line, 74, y + lineIndex * 6);
      });
      y += Math.max(wrappedValue.length, 1) * 6 + 4;
    });
    doc.setDrawColor(brand.accent);
    const footerY = Math.max(y + 10, 170);
    doc.line(18, footerY, 192, footerY);
    doc.setTextColor("#667085");
    doc.text("Generated by Sam Creative Payment Tracker", 18, footerY + 14);
    doc.save(`${payment.payerName.replace(/\s+/g, "-")}-${payment.id}.pdf`);
  }

  function exportCsv() {
    const header = ["date", "payer", "business", "item", "amount", "method", "status", "balance"];
    const rows = scopedPayments.map((payment) => [
      payment.date,
      payment.payerName,
      payment.businessName,
      payment.itemTitle,
      payment.amount,
      payment.method,
      payment.status,
      payment.balance,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payment-records-${scope}-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportFollowUps() {
    const header = ["payer", "phone", "email", "business", "item", "due_date", "balance", "status", "days_until_due", "last_payment"];
    const rows = followUpLedger.items.map((item) => [
      item.payerName,
      item.phone,
      item.email,
      businesses[item.businessId].shortName,
      item.itemTitle,
      item.dueDate,
      item.balance,
      item.status,
      item.daysUntilDue,
      item.lastPaymentDate ?? "",
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `payment-follow-ups-${scope}-${today}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportMonthlyPdf() {
    const { default: jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    const active = scopedPayments.filter((payment) => !payment.isDeleted);
    const total = active.reduce((sum, payment) => sum + payment.amount, 0);
    const mpesa = active.filter((payment) => payment.method === "M-Pesa").reduce((sum, payment) => sum + payment.amount, 0);
    const cash = active.filter((payment) => payment.method === "Cash").reduce((sum, payment) => sum + payment.amount, 0);
    const bank = active.filter((payment) => payment.method === "Bank Transfer").reduce((sum, payment) => sum + payment.amount, 0);

    doc.setFillColor(activeBrand.primary);
    doc.rect(0, 0, 210, 34, "F");
    doc.setTextColor("#ffffff");
    doc.setFontSize(17);
    doc.text("PayTrack Monthly Income Report", 18, 18);
    doc.setFontSize(10);
    doc.text(scope === "combined" ? "Combined business scope" : businesses[scope].name, 18, 26);
    doc.setTextColor(activeBrand.primary);
    doc.setFontSize(20);
    doc.text(money.format(total), 18, 52);
    doc.setTextColor("#667085");
    doc.setFontSize(11);
    doc.text(`Generated ${dateFmt.format(new Date(today))}`, 18, 62);

    const rows = [
      ["Transactions", String(active.length)],
      ["M-Pesa", money.format(mpesa)],
      ["Cash", money.format(cash)],
      ["Bank Transfer", money.format(bank)],
      ["Outstanding balances", money.format(outstanding)],
    ];
    rows.forEach(([label, value], index) => {
      const y = 82 + index * 10;
      doc.setTextColor("#667085");
      doc.text(label, 18, y);
      doc.setTextColor("#172033");
      doc.text(value, 86, y);
    });

    doc.setTextColor(activeBrand.primary);
    doc.setFontSize(14);
    doc.text("Business split", 18, 148);
    Object.values(businesses).forEach((business, index) => {
      const businessTotal = active
        .filter((payment) => payment.businessId === business.id)
        .reduce((sum, payment) => sum + payment.amount, 0);
      const y = 162 + index * 10;
      doc.setTextColor("#667085");
      doc.text(business.name, 18, y);
      doc.setTextColor("#172033");
      doc.text(money.format(businessTotal), 120, y);
    });
    doc.save(`paytrack-income-report-${scope}-${today}.pdf`);
  }

  return (
    <MoneyPrivacyContext.Provider value={moneyPrivacy}>
      <div className="money-pattern min-h-screen transition-colors" style={{ backgroundColor: activeBrand.light }}>
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-72 transform text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{ backgroundColor: activeBrand.primary }}
        >
          <div className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <img
                  src="/logo.svg"
                  alt="PayTrack logo"
                  className="h-12 w-12 rounded-xl border border-white/15 bg-white shadow-sm"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Payment Records</p>
                  <h1 className="mt-1 text-xl font-semibold leading-tight">PayTrack</h1>
                  <p className="mt-0.5 truncate text-xs text-white/60">Sam Creative Finance</p>
                </div>
              </div>
              <button className="rounded p-2 text-white/80 hover:bg-white/10 lg:hidden" onClick={() => setMobileOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 rounded border border-white/15 bg-white/[0.08] p-1">
              {(["combined", "scds", "graphics"] as BusinessScope[]).map((entry) => (
                <button
                  key={entry}
                  className={`w-full rounded px-3 py-2 text-left text-sm font-medium transition ${
                    scope === entry ? "bg-white text-slate-950" : "text-white/72 hover:bg-white/10 hover:text-white"
                  }`}
                  onClick={() => setScope(entry)}
                >
                  {entry === "combined" ? "Combined View" : businesses[entry].shortName}
                </button>
              ))}
            </div>

            <nav className="mt-7 space-y-1">
              {nav.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition ${
                    view === id ? "bg-white text-slate-950" : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                  onClick={() => {
                    if (id === "add") {
                      setEditingPaymentId(null);
                    }
                    setView(id);
                    setMobileOpen(false);
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="money-sidebar-graphic mt-7 rounded border border-white/12 p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Cash flow</p>
                  <p className="mt-1 text-sm font-semibold">KES ledger</p>
                </div>
                <Coins className="h-6 w-6 text-white/75" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-1">
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className="mt-auto rounded border border-white/12 p-4 text-sm text-white/70">
              <p className="font-medium text-white">Admin only</p>
              <p className="mt-1">Supabase Auth and RLS schema included for production access control.</p>
              <div className="mt-4 rounded bg-white/10 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Storage</p>
                <p className="mt-1 font-medium text-white">
                  {saveState === "loading"
                    ? "Loading online records"
                    : saveState === "saving"
                      ? "Saving online"
                      : saveState === "error"
                        ? "Online sync failed"
                        : storageBackend === "supabase"
                          ? "Saved online"
                          : "Saved locally"}
                </p>
                {lastSavedAt && (
                  <p className="mt-1 text-xs text-white/60">Last saved {dateFmt.format(new Date(lastSavedAt))}</p>
                )}
                {storageError && <p className="mt-1 text-xs text-white/60">{storageError}</p>}
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 px-4 py-3 backdrop-blur lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button className="rounded border border-slate-200 p-2 lg:hidden" onClick={() => setMobileOpen(true)}>
                  <Menu className="h-5 w-5" />
                </button>
                <img src="/logo.svg" alt="" className="hidden h-10 w-10 rounded-lg border border-slate-200 bg-white sm:block lg:hidden" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-slate-500">Current scope</p>
                  <h2 className="truncate text-lg font-semibold text-slate-950">
                    {scope === "combined" ? "Combined Business View" : businesses[scope].name}
                  </h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTotalsVisible((current) => !current)}
                  className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300"
                  aria-pressed={totalsVisible}
                >
                  {totalsVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  <span className="hidden sm:inline">{totalsVisible ? "Hide totals" : "Show totals"}</span>
                </button>
                <button
                  onClick={() => {
                    setEditingPaymentId(null);
                    setView("add");
                  }}
                  className="money-glow-button inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{ backgroundColor: activeBrand.accent }}
                >
                  <Plus className="h-4 w-4" />
                  Add Payment
                </button>
              </div>
            </div>
          </header>

          <div className="px-4 py-6 lg:px-8">
            {view === "home" && (
              <HomeView
                activeBrand={activeBrand}
                scope={scope}
                totalCollected={totalCollected}
                weeklyEarnings={weeklyEarnings}
                outstanding={outstanding}
                transactions={activePayments.length}
                activePayers={scopedPayers.length}
                confidenceScore={confidenceLedger.score}
                onNavigate={setView}
              />
            )}
            {view === "dashboard" && (
              <Dashboard
                activeBrand={activeBrand}
                totalCollected={totalCollected}
                outstanding={outstanding}
                transactions={activePayments.length}
                activePayers={scopedPayers.length}
                trend={trend}
                recent={scopedPayments.slice(0, 6)}
                confidenceLedger={confidenceLedger}
                followUpLedger={followUpLedger}
                dateRange={dateRange}
                setDateRange={setDateRange}
                customFrom={customFrom}
                setCustomFrom={setCustomFrom}
                customTo={customTo}
                setCustomTo={setCustomTo}
                onExportFollowUps={exportFollowUps}
                onPrint={printReceipt}
                onShareReceipt={openReceiptShare}
              />
            )}
            {view === "payments" && (
              <PaymentsView
                activeBrand={activeBrand}
                query={query}
                setQuery={setQuery}
                methodFilter={methodFilter}
                setMethodFilter={setMethodFilter}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                dateRange={dateRange}
                setDateRange={setDateRange}
                customFrom={customFrom}
                setCustomFrom={setCustomFrom}
                customTo={customTo}
                setCustomTo={setCustomTo}
                payments={scopedPayments}
                confidenceLedger={confidenceLedger}
                onEdit={startEditingPayment}
                onDelete={softDelete}
                onPrint={printReceipt}
                onShareReceipt={openReceiptShare}
                onExport={exportCsv}
              />
            )}
            {view === "overdue" && (
              <OverdueView
                activeBrand={activeBrand}
                ledger={followUpLedger}
                onExportFollowUps={exportFollowUps}
                onCloseBalance={closeItemBalance}
              />
            )}
            {view === "payers" && (
              <PayersView
                activeBrand={activeBrand}
                payers={scopedPayers}
                items={items}
                payments={payments}
                selectedPayer={selectedPayer}
                setSelectedPayerId={setSelectedPayerId}
                auditLog={auditLog}
                onPrint={printReceipt}
                onShareReceipt={openReceiptShare}
                onUpdatePayer={updatePayer}
                onCloseBalance={closeItemBalance}
              />
            )}
            {view === "add" && (
              <AddPaymentView
                activeBrand={activeBrand}
                scope={scope}
                payers={payers}
                savedFlash={savedFlash}
                editContext={editContext}
                onCancelEdit={cancelEditingPayment}
                onSubmit={editContext ? editPayment : addPayment}
              />
            )}
            {view === "reports" && (
              <ReportsView
                activeBrand={activeBrand}
                scopedPayments={scopedPayments}
                trend={trend}
                followUpLedger={followUpLedger}
                onExport={exportCsv}
                onExportFollowUps={exportFollowUps}
                onExportMonthlyPdf={exportMonthlyPdf}
              />
            )}
            {view === "trash" && (
              <TrashView
                activeBrand={activeBrand}
                payments={trashPayments}
                onRestore={restorePayment}
              />
            )}
            {view === "settings" && (
              <SettingsView
                activeBrand={activeBrand}
                storageBackend={storageBackend}
                saveState={saveState}
                storageError={storageError}
                lastSavedAt={lastSavedAt}
                roles={roles}
              />
            )}
          </div>
        </main>
      </div>
      </div>
    </MoneyPrivacyContext.Provider>
  );
}

function HomeView({
  activeBrand,
  scope,
  totalCollected,
  weeklyEarnings,
  outstanding,
  transactions,
  activePayers,
  confidenceScore,
  onNavigate,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scope: BusinessScope;
  totalCollected: number;
  weeklyEarnings: number;
  outstanding: number;
  transactions: number;
  activePayers: number;
  confidenceScore: number;
  onNavigate: (view: View) => void;
}) {
  const scopeLabel = scope === "combined" ? "Sam Creative businesses" : activeBrand.name;
  const { formatMoney } = useMoneyPrivacy();

  return (
    <div className="space-y-6">
      <MoneyDashboardGraphic
        activeBrand={activeBrand}
        totalCollected={totalCollected}
        outstanding={outstanding}
        transactions={transactions}
        activePayers={activePayers}
        eyebrow="PayTrack home"
        title={`Welcome back to ${scopeLabel}.`}
        description="Review cash flow, open finance reports, add new payments, and follow up on balances from one money-focused workspace."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HomeActionCard
          icon={Plus}
          label="Record payment"
          detail="Add a new payment and receipt details."
          color={activeBrand.accent}
          onClick={() => onNavigate("add")}
        />
        <HomeActionCard
          icon={ReceiptText}
          label="View payments"
          detail="Search transactions and print receipts."
          color={activeBrand.primary}
          onClick={() => onNavigate("payments")}
        />
        <HomeActionCard
          icon={UsersRound}
          label="Clients & students"
          detail="Check payer profiles and balances."
          color={activeBrand.success}
          onClick={() => onNavigate("payers")}
        />
        <HomeActionCard
          icon={BarChart3}
          label="Reports"
          detail="Export ledgers and follow-up lists."
          color={activeBrand.alert}
          onClick={() => onNavigate("reports")}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Collected" value={formatMoney(totalCollected)} icon={Banknote} color={activeBrand.accent} />
        <MetricCard label="This Week" value={formatMoney(weeklyEarnings)} icon={CalendarDays} color={activeBrand.primary} />
        <MetricCard label="Open Balances" value={formatMoney(outstanding)} icon={Activity} color={activeBrand.alert} />
        <MetricCard label="Audit Confidence" value={`${confidenceScore}%`} icon={ShieldCheck} color={confidenceScore >= 85 ? activeBrand.success : activeBrand.alert} />
      </section>
    </div>
  );
}

function HomeActionCard({
  icon: Icon,
  label,
  detail,
  color,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      className="home-action-card money-glow-card group rounded border border-slate-200 bg-white p-5 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
      onClick={onClick}
      style={{ "--glow-color": color, borderTopColor: color, borderTopWidth: 3 } as React.CSSProperties}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="home-action-icon inline-flex h-11 w-11 items-center justify-center rounded border border-slate-200 bg-slate-50" style={{ color }}>
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-500" />
      </div>
      <p className="mt-4 text-base font-semibold text-slate-950">{label}</p>
      <p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p>
    </button>
  );
}

function DateRangeControls({
  dateRange,
  setDateRange,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
}: {
  dateRange: DateRangeFilter;
  setDateRange: (value: DateRangeFilter) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-3 shadow-soft">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <CalendarDays className="h-4 w-4 text-slate-500" />
        Date range
      </div>
      <select
        value={dateRange}
        onChange={(event) => setDateRange(event.target.value as DateRangeFilter)}
        className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
      >
        <option value="today">Today</option>
        <option value="week">This week</option>
        <option value="month">This month</option>
        <option value="all">All dates</option>
        <option value="custom">Custom</option>
      </select>
      <input
        type="date"
        value={customFrom}
        onChange={(event) => setCustomFrom(event.target.value)}
        disabled={dateRange !== "custom"}
        className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
      />
      <input
        type="date"
        value={customTo}
        onChange={(event) => setCustomTo(event.target.value)}
        disabled={dateRange !== "custom"}
        className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
      />
    </div>
  );
}

function Dashboard({
  activeBrand,
  totalCollected,
  outstanding,
  transactions,
  activePayers,
  trend,
  recent,
  confidenceLedger,
  followUpLedger,
  dateRange,
  setDateRange,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  onExportFollowUps,
  onPrint,
  onShareReceipt,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  totalCollected: number;
  outstanding: number;
  transactions: number;
  activePayers: number;
  trend: TrendPoint[];
  recent: EnrichedPayment[];
  confidenceLedger: ConfidenceLedger;
  followUpLedger: FollowUpLedger;
  dateRange: DateRangeFilter;
  setDateRange: (value: DateRangeFilter) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  onExportFollowUps: () => void;
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onShareReceipt: (payment: EnrichedPayment) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();

  return (
    <div className="space-y-6">
      <DateRangeControls
        dateRange={dateRange}
        setDateRange={setDateRange}
        customFrom={customFrom}
        setCustomFrom={setCustomFrom}
        customTo={customTo}
        setCustomTo={setCustomTo}
      />
      <MoneyDashboardGraphic
        activeBrand={activeBrand}
        totalCollected={totalCollected}
        outstanding={outstanding}
        transactions={transactions}
        activePayers={activePayers}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Collected" value={formatMoney(totalCollected)} icon={Banknote} color={activeBrand.accent} />
        <MetricCard label="Outstanding Balance" value={formatMoney(outstanding)} icon={Activity} color={activeBrand.alert} />
        <MetricCard label="Transactions" value={String(transactions)} icon={ReceiptText} color={activeBrand.success} />
        <MetricCard label="Audit Health" value={`${confidenceLedger.score}%`} icon={ShieldCheck} color={confidenceLedger.score >= 85 ? activeBrand.success : activeBrand.alert} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="6-Month Income Trend" icon={BarChart3}>
          <div className="h-80">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading chart...</div>}>
              <IncomeTrendChart trend={trend} accent={activeBrand.accent} />
            </Suspense>
          </div>
        </Panel>
        <Panel title="Recent Payments" icon={CalendarDays}>
          <CompactPayments payments={recent} onPrint={onPrint} onShareReceipt={onShareReceipt} />
        </Panel>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ConfidencePanel ledger={confidenceLedger} activeBrand={activeBrand} />
        <FollowUpPanel ledger={followUpLedger} activeBrand={activeBrand} onExport={onExportFollowUps} />
      </section>
    </div>
  );
}

function MoneyDashboardGraphic({
  activeBrand,
  totalCollected,
  outstanding,
  transactions,
  activePayers,
  eyebrow = "Money dashboard",
  title = "Track every shilling from payment to balance.",
  description = "Collection totals, outstanding balances, receipts, and follow-ups are visualized as one finance ledger.",
}: {
  activeBrand: (typeof businesses)[BusinessId];
  totalCollected: number;
  outstanding: number;
  transactions: number;
  activePayers: number;
  eyebrow?: string;
  title?: string;
  description?: string;
}) {
  const { formatMoney } = useMoneyPrivacy();

  return (
    <section
      className="home-hero-motion money-dashboard-graphic overflow-hidden rounded border border-slate-200 p-5 text-white shadow-soft md:p-6"
      style={{ "--brand-primary": activeBrand.primary, "--brand-accent": activeBrand.accent } as React.CSSProperties}
    >
      <div className="relative z-10 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/75">
            <WalletGlyph />
            {eyebrow}
          </div>
          <h2 className="mt-4 max-w-2xl text-2xl font-semibold leading-tight md:text-3xl">
            {title}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/72">
            {description}
          </p>
          <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-3">
            <MoneyGraphicStat label="Collected" value={formatMoney(totalCollected)} />
            <MoneyGraphicStat label="Outstanding" value={formatMoney(outstanding)} />
            <MoneyGraphicStat label="Records" value={`${transactions} / ${activePayers}`} />
          </div>
        </div>

        <div className="money-stack-illustration" aria-hidden="true">
          <div className="money-note note-one">
            <span>KES</span>
            <strong><MoneyAmount value={Math.max(totalCollected, 0)} compact /></strong>
          </div>
          <div className="money-note note-two">
            <span>PAID</span>
            <CreditCard className="h-7 w-7" />
          </div>
          <div className="coin coin-one">K</div>
          <div className="coin coin-two">S</div>
          <div className="coin coin-three">+</div>
        </div>
      </div>
    </section>
  );
}

function MoneyGraphicStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/14 bg-white/10 px-3 py-3 backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold tabular text-white">{value}</p>
    </div>
  );
}

function WalletGlyph() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/14">
      <CreditCard className="h-3.5 w-3.5" />
    </span>
  );
}

function PaymentsView(props: {
  activeBrand: (typeof businesses)[BusinessId];
  query: string;
  setQuery: (value: string) => void;
  methodFilter: "all" | PaymentMethod;
  setMethodFilter: (value: "all" | PaymentMethod) => void;
  statusFilter: "all" | PaymentStatus;
  setStatusFilter: (value: "all" | PaymentStatus) => void;
  dateRange: DateRangeFilter;
  setDateRange: (value: DateRangeFilter) => void;
  customFrom: string;
  setCustomFrom: (value: string) => void;
  customTo: string;
  setCustomTo: (value: string) => void;
  payments: EnrichedPayment[];
  confidenceLedger: ConfidenceLedger;
  onEdit: (payment: EnrichedPayment) => void;
  onDelete: (payment: Payment) => void;
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onShareReceipt: (payment: EnrichedPayment) => void;
  onExport: () => void;
}) {
  const visiblePayments = props.payments.filter((payment) => !payment.isDeleted);
  const { formatMoney } = useMoneyPrivacy();

  return (
    <Panel title="Payment Records" icon={ReceiptText} action={<IconButton label="Export CSV" icon={Download} onClick={props.onExport} glow />}>
      <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_150px_150px_160px_150px_150px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="Search payer, phone, item, or M-Pesa code"
            className="w-full rounded border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </label>
        <select
          value={props.methodFilter}
          onChange={(event) => props.setMethodFilter(event.target.value as "all" | PaymentMethod)}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All methods</option>
          <option>M-Pesa</option>
          <option>Cash</option>
          <option>Bank Transfer</option>
        </select>
        <select
          value={props.statusFilter}
          onChange={(event) => props.setStatusFilter(event.target.value as "all" | PaymentStatus)}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option>Paid</option>
          <option>Partial</option>
          <option>Pending</option>
        </select>
        <select
          value={props.dateRange}
          onChange={(event) => props.setDateRange(event.target.value as DateRangeFilter)}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="all">All dates</option>
          <option value="custom">Custom</option>
        </select>
        <input
          type="date"
          value={props.customFrom}
          onChange={(event) => props.setCustomFrom(event.target.value)}
          disabled={props.dateRange !== "custom"}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
        <input
          type="date"
          value={props.customTo}
          onChange={(event) => props.setCustomTo(event.target.value)}
          disabled={props.dateRange !== "custom"}
          className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {["Date", "Payer", "Business", "Item", "Amount", "Method", "Status", "Balance", "Actions"].map((head) => (
                <th key={head} className="px-3 py-3 font-semibold">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiblePayments.length ? (
              visiblePayments.map((payment) => {
                const canRemindBalance = payment.balance > 0 && canMessagePhone(payment.payerPhone);
                const canShareReceipt = canMessagePhone(payment.payerPhone);
                const canSendSms = Boolean(normalizeSmsPhone(payment.payerPhone));

                return (
                  <tr key={payment.id} className="border-b border-slate-100 bg-white">
                    <td className="px-3 py-3 tabular">{dateFmt.format(new Date(payment.date))}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-slate-950">{payment.payerName}</p>
                      <PaymentConfidenceBadge issues={props.confidenceLedger.byPaymentId[payment.id] ?? []} />
                    </td>
                    <td className="px-3 py-3">{payment.businessName}</td>
                    <td className="px-3 py-3">{payment.itemTitle}</td>
                    <td className="px-3 py-3 font-semibold tabular">{formatMoney(payment.amount)}</td>
                    <td className="px-3 py-3">{payment.method}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status={payment.status} brand={props.activeBrand} edited={payment.edited} />
                    </td>
                    <td className="px-3 py-3 tabular">{formatMoney(payment.balance)}</td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1">
                        {canRemindBalance && (
                          <IconButton
                            label="Send balance reminder"
                            icon={MessageCircle}
                            onClick={() => openWhatsAppReminder(reminderFromPayment(payment))}
                            glow
                          />
                        )}
                        {canRemindBalance && canSendSms && (
                          <IconButton
                            label="Send balance SMS"
                            icon={Smartphone}
                            onClick={() => openSmsReminder(reminderFromPayment(payment))}
                          />
                        )}
                        <IconButton label="Edit payment" icon={Pencil} onClick={() => props.onEdit(payment)} glow={!canRemindBalance} />
                        <IconButton label="Print receipt" icon={Printer} onClick={() => props.onPrint(payment)} />
                        {canShareReceipt && (
                          <IconButton
                            label="Share receipt message"
                            icon={MessageCircle}
                            onClick={() => props.onShareReceipt(payment)}
                          />
                        )}
                        {canSendSms && (
                          <IconButton
                            label="Send receipt SMS"
                            icon={Smartphone}
                            onClick={() => openReceiptSms(payment)}
                          />
                        )}
                        <IconButton label="Move to trash" icon={Trash2} onClick={() => props.onDelete(payment)} />
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-500">
                  No payment records found. Add the first payment to start tracking balances.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TrashView({
  activeBrand,
  payments,
  onRestore,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  payments: EnrichedPayment[];
  onRestore: (payment: Payment) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();

  return (
    <Panel title="Trash" icon={Trash2}>
      <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Deleted payments stay here for {trashRetentionDays} days. After that, expired trash is permanently removed as a group during online sync.
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[900px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              {["Deleted", "Payer", "Business", "Item", "Amount", "Status", "Retention", "Actions"].map((head) => (
                <th key={head} className="px-3 py-3 font-semibold">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.length ? (
              payments.map((payment) => {
                const daysLeft = daysUntilTrashPurge(payment);

                return (
                  <tr key={payment.id} className="border-b border-slate-100 bg-white">
                    <td className="px-3 py-3 tabular">{dateFmt.format(new Date(payment.deletedAt ?? payment.updatedAt))}</td>
                    <td className="px-3 py-3 font-medium text-slate-950">{payment.payerName}</td>
                    <td className="px-3 py-3">{payment.businessName}</td>
                    <td className="px-3 py-3">{payment.itemTitle}</td>
                    <td className="px-3 py-3 font-semibold tabular">{formatMoney(payment.amount)}</td>
                    <td className="px-3 py-3">
                      <StatusBadge status="Deleted" brand={activeBrand} />
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {daysLeft <= 0 ? "Deletes on next sync" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                    </td>
                    <td className="px-3 py-3">
                      <IconButton label="Restore" icon={ArchiveRestore} onClick={() => onRestore(payment)} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">
                  Trash is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function PayersView({
  activeBrand,
  payers,
  items,
  payments,
  selectedPayer,
  setSelectedPayerId,
  auditLog,
  onPrint,
  onShareReceipt,
  onUpdatePayer,
  onCloseBalance,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  payers: Payer[];
  items: Item[];
  payments: Payment[];
  selectedPayer: Payer | null | undefined;
  setSelectedPayerId: (id: string) => void;
  auditLog: AuditEntry[];
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onShareReceipt: (payment: EnrichedPayment) => void;
  onUpdatePayer: (payerId: string, updates: Pick<Payer, "fullName" | "phone" | "email" | "type">) => void;
  onCloseBalance: (itemId: string, reason?: string) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Panel title="Payer Profiles" icon={UsersRound}>
        <div className="space-y-3">
          {payers.length ? payers.map((payer) => {
            const payerItems = items.filter((item) => item.payerId === payer.id && isCollectibleItem(item, payments));
            const payerItemIds = new Set(payerItems.map((item) => item.id));
            const totalDue = payerItems.reduce((sum, item) => sum + item.totalAmount, 0);
            const paid = payments
              .filter((payment) => payment.payerId === payer.id && payerItemIds.has(payment.itemId) && !payment.isDeleted)
              .reduce((sum, payment) => sum + payment.amount, 0);
            return (
              <button
                key={payer.id}
                className="w-full rounded border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-300"
                onClick={() => setSelectedPayerId(payer.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-slate-950">{payer.fullName}</p>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium capitalize text-slate-600">{payer.type}</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{payer.phone || "No phone saved"}</p>
                <p className="mt-1 text-xs text-slate-400">{payer.email || "No email saved"}</p>
                <div className="mt-3 flex justify-between text-sm tabular">
                  <span>{formatMoney(paid)} paid</span>
                  <span style={{ color: activeBrand.alert }}>{formatMoney(Math.max(totalDue - paid, 0))} due</span>
                </div>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                  <Pencil className="h-3.5 w-3.5" />
                  Open / edit contact
                </div>
              </button>
            );
          }) : (
            <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
              No payer profiles yet. Profiles are created when you add a payment for a new payer.
            </div>
          )}
        </div>
      </Panel>
      <Panel title={selectedPayer ? selectedPayer.fullName : "Profile Details"} icon={BriefcaseBusiness}>
        {selectedPayer ? (
          <ProfileDetails payer={selectedPayer} items={items} payments={payments} auditLog={auditLog} activeBrand={activeBrand} onPrint={onPrint} onShareReceipt={onShareReceipt} onUpdatePayer={onUpdatePayer} onCloseBalance={onCloseBalance} />
        ) : (
          <p className="text-sm text-slate-500">Select a payer to inspect balances, history, and audit entries.</p>
        )}
      </Panel>
    </div>
  );
}

function AddPaymentView({
  activeBrand,
  scope,
  payers,
  savedFlash,
  editContext,
  onCancelEdit,
  onSubmit,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scope: BusinessScope;
  payers: Payer[];
  savedFlash: boolean;
  editContext?: EditPaymentContext;
  onCancelEdit: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const defaultBusiness = scope === "graphics" ? "graphics" : "scds";
  const isEditing = Boolean(editContext);
  const initialForm = useMemo<FormState>(
    () => ({
      businessId: editContext?.payment.businessId ?? defaultBusiness,
      payerId: editContext?.payment.payerId ?? "",
      newPayerName: "",
      newPayerPhone: "",
      newPayerEmail: "",
      itemTitle: editContext?.item.title ?? "",
      totalDue: isEditing ? String(editContext?.item.totalAmount) : "",
      installmentCount: isEditing ? String(editContext?.item.installmentCount ?? 1) : "1",
      installmentFrequency: editContext?.item.installmentFrequency ?? "once",
      amount: isEditing ? String(editContext?.payment.amount) : "",
      method: editContext?.payment.method ?? "M-Pesa",
      mpesaCode: editContext?.payment.mpesaCode ?? "",
      date: editContext?.payment.date ?? today,
      dueDate: editContext?.item.dueDate ?? today,
      notes: editContext?.payment.notes ?? "",
    }),
    [
      defaultBusiness,
      editContext?.item.dueDate,
      editContext?.item.installmentCount,
      editContext?.item.installmentFrequency,
      editContext?.item.title,
      editContext?.item.totalAmount,
      editContext?.payment.amount,
      editContext?.payment.businessId,
      editContext?.payment.date,
      editContext?.payment.method,
      editContext?.payment.mpesaCode,
      editContext?.payment.notes,
      editContext?.payment.payerId,
      isEditing,
    ],
  );
  const [form, setForm] = useState<FormState>(initialForm);
  const { formatMoney } = useMoneyPrivacy();
  const balance = Math.max(Number(form.totalDue || 0) - Number(form.amount || 0) - (editContext?.otherPaidForItem ?? 0), 0);
  const businessPayers = payers.filter((payer) => payer.businessId === form.businessId);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const updateForm = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  return (
    <Panel title={isEditing ? "Edit Payment" : "Add Payment"} icon={isEditing ? Pencil : Plus}>
      {savedFlash && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Payment saved. WhatsApp or SMS was opened when a phone number was available.
        </div>
      )}
      <form
        onSubmit={(event) => {
          onSubmit(event);
          if (!isEditing) {
            setForm(initialForm);
          }
        }}
        className="grid gap-4 lg:grid-cols-2"
      >
        <Field label="Business">
          <select name="businessId" value={form.businessId} onChange={updateForm} className="input" disabled={isEditing}>
            <option value="scds">Sam Creative Design School</option>
            <option value="graphics">Sam Creative Graphics</option>
          </select>
        </Field>
        <Field label="Existing payer">
          <select name="payerId" value={form.payerId} onChange={updateForm} className="input" required={!form.newPayerName} disabled={isEditing}>
            <option value="">Select payer or add new below</option>
            {businessPayers.map((payer) => (
              <option key={payer.id} value={payer.id}>{payer.fullName}</option>
            ))}
          </select>
        </Field>
        <Field label="New payer name">
          <input name="newPayerName" value={form.newPayerName} onChange={updateForm} className="input" placeholder="Optional" disabled={isEditing} />
        </Field>
        <Field label="New payer phone">
          <input name="newPayerPhone" value={form.newPayerPhone} onChange={updateForm} className="input" placeholder="+254 ..." disabled={isEditing} />
        </Field>
        <Field label="New payer email (optional)">
          <input name="newPayerEmail" value={form.newPayerEmail} onChange={updateForm} type="email" className="input" placeholder="name@example.com" disabled={isEditing} />
        </Field>
        <Field label="Course or project">
          <input name="itemTitle" value={form.itemTitle} onChange={updateForm} className="input" required placeholder="Course/project name" />
        </Field>
        <Field label="Total amount due">
          <input name="totalDue" value={form.totalDue} onChange={updateForm} type="number" min="0" className="input tabular" required />
        </Field>
        <Field label="Installments">
          <input name="installmentCount" value={form.installmentCount} onChange={updateForm} type="number" min="1" className="input tabular" />
        </Field>
        <Field label="Installment frequency">
          <select name="installmentFrequency" value={form.installmentFrequency} onChange={updateForm} className="input">
            <option value="once">Once</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <Field label={isEditing ? "Payment amount" : "Amount paid now"}>
          <input name="amount" value={form.amount} onChange={updateForm} type="number" min="0" className="input tabular" required />
        </Field>
        <Field label="Payment method">
          <select name="method" value={form.method} onChange={updateForm} className="input">
            <option>M-Pesa</option>
            <option>Cash</option>
            <option>Bank Transfer</option>
          </select>
        </Field>
        {form.method === "M-Pesa" && (
          <Field label="M-Pesa transaction code">
            <input name="mpesaCode" value={form.mpesaCode} onChange={updateForm} className="input uppercase" placeholder="TH..." />
          </Field>
        )}
        <Field label="Payment date">
          <input name="date" type="date" value={form.date} onChange={updateForm} className="input tabular" />
        </Field>
        <Field label="Due date">
          <input name="dueDate" type="date" value={form.dueDate} onChange={updateForm} className="input tabular" />
        </Field>
        <div className="lg:col-span-2">
          <Field label="Notes">
            <textarea name="notes" value={form.notes} onChange={updateForm} rows={4} className="input resize-y" />
          </Field>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Calculated balance</p>
          <p className="mt-1 text-2xl font-semibold tabular" style={{ color: balance === 0 ? activeBrand.success : activeBrand.alert }}>
            {formatMoney(balance)}
          </p>
        </div>
        {!isEditing ? (
          <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <MessageCircle className="h-4 w-4" />
              Customer message
            </div>
            <p className="mt-2">Saving opens WhatsApp first, with SMS as the fallback when needed.</p>
          </div>
        ) : (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Paid records can be corrected here. The audit ledger will mark this payment as edited.
          </div>
        )}
        <div className="flex flex-wrap items-end justify-end gap-2">
          {isEditing && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}
          <button
            className="money-glow-button inline-flex items-center gap-2 rounded px-5 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{ backgroundColor: activeBrand.accent }}
          >
            {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isEditing ? "Save Changes" : "Save Payment"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function ReportsView({
  activeBrand,
  scopedPayments,
  trend,
  followUpLedger,
  onExport,
  onExportFollowUps,
  onExportMonthlyPdf,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scopedPayments: EnrichedPayment[];
  trend: TrendPoint[];
  followUpLedger: FollowUpLedger;
  onExport: () => void;
  onExportFollowUps: () => void;
  onExportMonthlyPdf: () => void | Promise<void>;
}) {
  const { formatMoney } = useMoneyPrivacy();
  const byBusiness = Object.values(businesses).map((business) => ({
    business,
    total: scopedPayments
      .filter((payment) => payment.businessId === business.id && !payment.isDeleted)
      .reduce((sum, payment) => sum + payment.amount, 0),
  }));
  return (
    <div className="space-y-6">
      <Panel
        title="Statements & Export"
        icon={FileText}
        action={
          <div className="flex gap-2">
            <IconButton label="Download CSV" icon={Download} onClick={onExport} />
            <IconButton label="Download monthly PDF" icon={FileText} onClick={onExportMonthlyPdf} glow />
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {byBusiness.map(({ business, total }) => (
            <div key={business.id} className="rounded border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-500">{business.name}</p>
              <p className="mt-3 text-3xl font-semibold tabular" style={{ color: business.accent }}>{formatMoney(total)}</p>
              <p className="mt-2 text-sm text-slate-500">Current filtered collection total</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Follow-Up Export" icon={CalendarDays} action={<IconButton label="Download follow-ups" icon={Download} onClick={onExportFollowUps} />}>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricMini label="Overdue" value={formatMoney(followUpLedger.overdueTotal)} color={activeBrand.alert} />
          <MetricMini label="Due Soon" value={formatMoney(followUpLedger.dueSoonTotal)} color={activeBrand.success} />
          <MetricMini label="Priority Items" value={String(followUpLedger.priorityCount)} color={activeBrand.accent} />
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Export a reminder-ready CSV containing payer contacts, due dates, balances, and last payment dates.
        </p>
      </Panel>
      <Panel title="Monthly Income" icon={BarChart3}>
        <div className="grid gap-2">
          {trend.map((entry) => (
            <div key={entry.month} className="grid grid-cols-[70px_1fr_120px] items-center gap-3 text-sm">
              <span className="font-medium text-slate-600">{entry.month}</span>
              <div className="h-2 rounded bg-slate-100">
                <div className="h-2 rounded" style={{ width: `${Math.min((entry.income / 150000) * 100, 100)}%`, backgroundColor: activeBrand.accent }} />
              </div>
              <span className="text-right font-semibold tabular">{formatMoney(entry.income)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SettingsView({
  activeBrand,
  storageBackend,
  saveState,
  storageError,
  lastSavedAt,
  roles,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  storageBackend: StorageBackend;
  saveState: "loading" | "saved" | "saving" | "error";
  storageError: string | null;
  lastSavedAt: string | null;
  roles: Record<string, "admin" | "staff">;
}) {
  return (
    <Panel title="Settings" icon={Settings}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-950">Cloud backup status</p>
          <p className="mt-2 text-sm text-slate-500">
            Current backend: <span className="font-semibold capitalize text-slate-800">{storageBackend}</span>. Status: <span className="font-semibold capitalize text-slate-800">{saveState}</span>.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {lastSavedAt ? `Last saved on ${dateFmt.format(new Date(lastSavedAt))}.` : "Waiting for the first completed save in this session."}
          </p>
          {storageError && <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{storageError}</p>}
        </div>
        <div className="rounded border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-950">Role-based access</p>
          <p className="mt-2 text-sm text-slate-500">
            App data stores staff/admin roles, while the Supabase schema enforces authenticated admin access with row-level security policies.
          </p>
          <div className="mt-4 space-y-2">
            {Object.entries(roles).map(([user, role]) => (
              <div key={user} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-sm">
                <span className="font-medium text-slate-800">{user}</span>
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase text-slate-600">{role}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-5 lg:col-span-2">
          <p className="font-semibold text-slate-950">Audit policy</p>
          <p className="mt-2 text-sm text-slate-500">
            Payment edits and soft deletes are logged. Production enforcement is handled by Postgres triggers in the included schema.
          </p>
          <div className="mt-4 h-1.5 rounded" style={{ backgroundColor: activeBrand.accent }} />
        </div>
      </div>
    </Panel>
  );
}

function ProfileDetails({
  payer,
  items,
  payments,
  auditLog,
  activeBrand,
  onPrint,
  onShareReceipt,
  onUpdatePayer,
  onCloseBalance,
}: {
  payer: Payer;
  items: Item[];
  payments: Payment[];
  auditLog: AuditEntry[];
  activeBrand: (typeof businesses)[BusinessId];
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onShareReceipt: (payment: EnrichedPayment) => void;
  onUpdatePayer: (payerId: string, updates: Pick<Payer, "fullName" | "phone" | "email" | "type">) => void;
  onCloseBalance: (itemId: string, reason?: string) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();
  const [isEditingContact, setIsEditingContact] = useState(false);
  const initialContactForm = useMemo(
    () => ({
      fullName: payer.fullName,
      phone: payer.phone,
      email: payer.email,
      type: payer.type,
    }),
    [payer.email, payer.fullName, payer.phone, payer.type],
  );
  const [contactForm, setContactForm] = useState(initialContactForm);
  const payerItems = items.filter((item) => item.payerId === payer.id && isCollectibleItem(item, payments));
  const payerPayments = payments.filter((payment) => payment.payerId === payer.id && !payment.isDeleted);
  const payerItemIds = new Set(payerItems.map((item) => item.id));
  const totalDue = payerItems.reduce((sum, item) => sum + item.totalAmount, 0);
  const paid = payerPayments.filter((payment) => payerItemIds.has(payment.itemId)).reduce((sum, payment) => sum + payment.amount, 0);
  const payerAudit = auditLog.filter((entry) => payerPayments.some((payment) => payment.id === entry.paymentId));
  const openBalances = payerItems
    .map((item) => {
      const paidForItem = payments
        .filter((payment) => payment.itemId === item.id && !payment.isDeleted)
        .reduce((sum, payment) => sum + payment.amount, 0);
      return { item, paid: paidForItem, balance: Math.max(item.totalAmount - paidForItem, 0) };
    })
    .filter((entry) => entry.balance > 0);

  useEffect(() => {
    setContactForm(initialContactForm);
    setIsEditingContact(false);
  }, [initialContactForm, payer.id]);

  const updateContactForm = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setContactForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const saveContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fullName = contactForm.fullName.trim();
    if (!fullName) return;
    onUpdatePayer(payer.id, {
      fullName,
      phone: contactForm.phone,
      email: contactForm.email,
      type: contactForm.type,
    });
    setIsEditingContact(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Contact details</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{payer.fullName}</p>
            <p className="mt-1 text-sm text-slate-500">
              {payer.phone || "No phone saved"} · {payer.email || "No email saved"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEditingContact((current) => !current)}
            className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300"
          >
            <Pencil className="h-4 w-4" />
            {isEditingContact ? "Close" : "Edit contact"}
          </button>
        </div>
        {isEditingContact && (
          <form onSubmit={saveContact} className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <input name="fullName" value={contactForm.fullName} onChange={updateContactForm} className="input" required />
            </Field>
            <Field label="Phone">
              <input name="phone" value={contactForm.phone} onChange={updateContactForm} className="input" placeholder="+254 ..." />
            </Field>
            <Field label="Email">
              <input name="email" value={contactForm.email} onChange={updateContactForm} type="email" className="input" placeholder="name@example.com" />
            </Field>
            <Field label="Payer type">
              <select name="type" value={contactForm.type} onChange={updateContactForm} className="input">
                <option value="student">Student</option>
                <option value="client">Client</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setContactForm(initialContactForm);
                  setIsEditingContact(false);
                }}
                className="inline-flex items-center rounded border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                Cancel
              </button>
              <button
                className="money-glow-button inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: activeBrand.accent }}
              >
                <Save className="h-4 w-4" />
                Save contact
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricMini label="Total Due" value={formatMoney(totalDue)} />
        <MetricMini label="Paid" value={formatMoney(paid)} />
        <MetricMini label="Balance" value={formatMoney(Math.max(totalDue - paid, 0))} color={activeBrand.alert} />
      </div>
      <div className="rounded border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-semibold text-slate-950">Balance management</p>
          <span className="text-xs font-semibold uppercase text-slate-400">{openBalances.length} open</span>
        </div>
        <div className="space-y-2">
          {openBalances.length ? (
            openBalances.map(({ item, paid: itemPaid, balance }) => {
              const reminder: FollowUpItem = {
                id: item.id,
                businessId: item.businessId,
                payerName: payer.fullName,
                phone: payer.phone,
                email: payer.email,
                itemTitle: item.title,
                dueDate: item.dueDate,
                balance,
                daysUntilDue: Math.ceil((new Date(`${item.dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000),
                status: new Date(`${item.dueDate}T00:00:00`) < new Date(`${today}T00:00:00`) ? "overdue" : "scheduled",
                lastPaymentDate: payerPayments.filter((payment) => payment.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date))[0]?.date,
              };
              return (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <div>
                    <p className="font-medium text-slate-950">{item.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Paid {formatMoney(itemPaid)} of {formatMoney(item.totalAmount)} · Due {dateFmt.format(new Date(item.dueDate))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold tabular" style={{ color: activeBrand.alert }}>{formatMoney(balance)}</span>
                    <IconButton label="Send reminder message" icon={MessageCircle} onClick={() => openWhatsAppReminder(reminder)} glow />
                    <IconButton label="Send reminder SMS" icon={Smartphone} onClick={() => openSmsReminder(reminder)} />
                    <IconButton label="Close balance" icon={ArchiveRestore} onClick={() => onCloseBalance(item.id, "Closed from client profile")} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              No open balances for this profile.
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[680px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="py-3">Date</th><th>Item</th><th>Amount</th><th>Status</th><th>Method</th><th>Receipt</th></tr>
          </thead>
          <tbody>
            {payerPayments.map((payment) => {
              const item = items.find((entry) => entry.id === payment.itemId);
              const paidForItem = payments
                .filter((entry) => entry.itemId === payment.itemId && !entry.isDeleted)
                .reduce((sum, entry) => sum + entry.amount, 0);
              const enrichedPayment: EnrichedPayment = {
                ...payment,
                payerName: payer.fullName,
                payerPhone: payer.phone,
                payerEmail: payer.email,
                itemTitle: item?.title ?? "Unassigned item",
                businessName: businesses[payment.businessId].shortName,
                balance: Math.max((item?.totalAmount ?? 0) - paidForItem, 0),
                dueDate: item?.dueDate ?? payment.date,
                totalAmount: item?.totalAmount ?? payment.amount,
              };
              return (
                <tr key={payment.id} className="border-b border-slate-100">
                  <td className="py-3 tabular">{dateFmt.format(new Date(payment.date))}</td>
                  <td>{item?.title}</td>
                  <td className="font-semibold tabular">{formatMoney(payment.amount)}</td>
                  <td><StatusBadge status={payment.status} brand={activeBrand} edited={payment.edited} /></td>
                  <td>{payment.method}</td>
                  <td>
                    <div className="flex gap-1">
                      <IconButton label="Download receipt" icon={Download} onClick={() => onPrint(enrichedPayment)} glow />
                      {canMessagePhone(enrichedPayment.payerPhone) && (
                        <IconButton label="Share receipt message" icon={MessageCircle} onClick={() => onShareReceipt(enrichedPayment)} />
                      )}
                      {normalizeSmsPhone(enrichedPayment.payerPhone) && (
                        <IconButton label="Send receipt SMS" icon={Smartphone} onClick={() => openReceiptSms(enrichedPayment)} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="rounded border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold text-slate-950">Audit history</summary>
        <div className="mt-3 space-y-2">
          {payerAudit.map((entry) => (
            <div key={entry.id} className="rounded bg-white p-3 text-sm">
              <span className="font-semibold capitalize">{entry.action}</span>
              <span className="text-slate-500"> on {dateFmt.format(new Date(entry.changedAt))} by {entry.changedBy}</span>
              <p className="mt-1 text-slate-500">Fields: {entry.changedFields.join(", ")}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function FollowUpPanel({
  ledger,
  activeBrand,
  onExport,
}: {
  ledger: FollowUpLedger;
  activeBrand: (typeof businesses)[BusinessId];
  onExport: () => void;
}) {
  const { formatMoney } = useMoneyPrivacy();
  const priorityItems = ledger.items.filter((item) => item.status !== "scheduled").slice(0, 5);

  return (
    <Panel title="Follow-Up & Cashflow Watchlist" icon={CalendarDays} action={<IconButton label="Export follow-ups" icon={Download} onClick={onExport} />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricMini label="Overdue" value={formatMoney(ledger.overdueTotal)} color={activeBrand.alert} />
        <MetricMini label="Due Soon" value={formatMoney(ledger.dueSoonTotal)} color={activeBrand.success} />
        <MetricMini label="Queue" value={String(ledger.priorityCount)} color={activeBrand.accent} />
      </div>
      <div className="mt-4 space-y-2">
        {priorityItems.length ? (
          priorityItems.map((item) => <FollowUpRow key={item.id} item={item} activeBrand={activeBrand} />)
        ) : (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            No overdue or near-due balances in the selected scope.
          </div>
        )}
      </div>
    </Panel>
  );
}

function FollowUpRow({
  item,
  activeBrand,
  onCloseBalance,
}: {
  item: FollowUpItem;
  activeBrand: (typeof businesses)[BusinessId];
  onCloseBalance?: (itemId: string, reason?: string) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();
  const isOverdue = item.status === "overdue";
  const color = isOverdue ? activeBrand.alert : activeBrand.success;
  const timing =
    item.daysUntilDue < 0
      ? `${Math.abs(item.daysUntilDue)} day${Math.abs(item.daysUntilDue) === 1 ? "" : "s"} overdue`
      : `Due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? "" : "s"}`;

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{item.payerName}</p>
          <p className="mt-1 text-sm text-slate-500">{item.itemTitle}</p>
          <p className="mt-1 text-xs text-slate-400">
            {item.phone || item.email || "No contact saved"}{item.lastPaymentDate ? ` · Last paid ${dateFmt.format(new Date(item.lastPaymentDate))}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular" style={{ color }}>{formatMoney(item.balance)}</p>
          <p className="mt-1 text-xs font-semibold uppercase" style={{ color }}>{timing}</p>
          <button
            className="mt-2 inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => openWhatsAppReminder(item)}
            disabled={!canMessagePhone(item.phone)}
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Message
          </button>
          <button
            className="mt-2 ml-2 inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => openSmsReminder(item)}
            disabled={!normalizeSmsPhone(item.phone)}
          >
            <Smartphone className="h-3.5 w-3.5" />
            SMS
          </button>
          {onCloseBalance && (
            <button
              className="mt-2 ml-2 inline-flex items-center rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
              onClick={() => onCloseBalance(item.id, "Closed from balance manager")}
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function OverdueView({
  activeBrand,
  ledger,
  onExportFollowUps,
  onCloseBalance,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  ledger: FollowUpLedger;
  onExportFollowUps: () => void;
  onCloseBalance: (itemId: string, reason?: string) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();
  const overdueItems = ledger.items
    .filter((item) => item.status === "overdue")
    .sort((a, b) => b.balance - a.balance || a.daysUntilDue - b.daysUntilDue);

  return (
    <div className="space-y-6">
      <Panel title="Overdue Balances" icon={AlertTriangle} action={<IconButton label="Download follow-ups" icon={Download} onClick={onExportFollowUps} glow />}>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricMini label="Overdue Total" value={formatMoney(ledger.overdueTotal)} color={activeBrand.alert} />
          <MetricMini label="Overdue Clients" value={String(overdueItems.length)} color={activeBrand.alert} />
          <MetricMini label="Message Ready" value={String(overdueItems.filter((item) => canMessagePhone(item.phone)).length)} color={activeBrand.accent} />
        </div>
        <div className="mt-5 space-y-2">
          {overdueItems.length ? (
            overdueItems.map((item) => <FollowUpRow key={item.id} item={item} activeBrand={activeBrand} onCloseBalance={onCloseBalance} />)
          ) : (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              No overdue balances in the selected scope.
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function ConfidencePanel({
  ledger,
  activeBrand,
}: {
  ledger: ConfidenceLedger;
  activeBrand: (typeof businesses)[BusinessId];
}) {
  const topIssues = ledger.issues.slice(0, 5);

  return (
    <Panel title="Payment Confidence Ledger" icon={ShieldCheck}>
      <div className="grid gap-4 md:grid-cols-[180px_1fr]">
        <div className="rounded border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase text-slate-500">Clean records</p>
          <p className="mt-2 text-4xl font-semibold tabular" style={{ color: ledger.score >= 85 ? activeBrand.success : activeBrand.alert }}>
            {ledger.score}%
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {ledger.issueCount === 0 ? "No review items found." : `${ledger.issueCount} review item${ledger.issueCount === 1 ? "" : "s"} found.`}
          </p>
        </div>
        <div className="space-y-2">
          {topIssues.length ? (
            topIssues.map((issue) => <ConfidenceIssueRow key={issue.id} issue={issue} />)
          ) : (
            <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Records look clean. Keep logging notes and transaction references as payments come in.
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ConfidenceIssueRow({ issue }: { issue: ConfidenceIssue }) {
  const color = confidenceColor(issue.severity);
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" style={{ color }} />
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">{issue.title}</p>
          <p className="mt-1 text-sm text-slate-500">{issue.detail}</p>
          {issue.payerName && <p className="mt-1 text-xs font-semibold uppercase text-slate-400">{issue.payerName}</p>}
        </div>
      </div>
    </div>
  );
}

function PaymentConfidenceBadge({ issues }: { issues: ConfidenceIssue[] }) {
  if (!issues.length) return null;
  const highest = issues.some((issue) => issue.severity === "critical")
    ? "critical"
    : issues.some((issue) => issue.severity === "warning")
      ? "warning"
      : "notice";
  const color = confidenceColor(highest);

  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold" style={{ backgroundColor: `${color}18`, color }}>
      <AlertTriangle className="h-3 w-3" />
      {issues.length} review
    </span>
  );
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  return (
    <div className="money-glow-card rounded border border-slate-200 bg-white p-5 shadow-soft" style={{ borderTopColor: color, borderTopWidth: 3, "--glow-color": color } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <p className="mt-4 text-2xl font-semibold text-slate-950 tabular">{value}</p>
    </div>
  );
}

function MetricMini({ label, value, color = "#172033" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular" style={{ color }}>{value}</p>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded border border-slate-200 bg-white p-5 shadow-soft">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-slate-500" />
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CompactPayments({
  payments,
  onPrint,
  onShareReceipt,
}: {
  payments: EnrichedPayment[];
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onShareReceipt: (payment: EnrichedPayment) => void;
}) {
  const { formatMoney } = useMoneyPrivacy();

  return (
    <div className="space-y-3">
      {payments.length ? (
        payments.map((payment) => (
          <div key={payment.id} className="flex items-center justify-between gap-3 rounded border border-slate-200 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-950">{payment.payerName}</p>
              <p className="truncate text-sm text-slate-500">{payment.itemTitle}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold tabular">{formatMoney(payment.amount)}</p>
              <div className="mt-1 flex justify-end gap-2 text-xs font-semibold">
                <button className="text-slate-500 hover:text-slate-950" onClick={() => onPrint(payment)}>Receipt</button>
                {canMessagePhone(payment.payerPhone) && (
                  <button className="text-slate-500 hover:text-slate-950" onClick={() => onShareReceipt(payment)}>Message</button>
                )}
                {normalizeSmsPhone(payment.payerPhone) && (
                  <button className="text-slate-500 hover:text-slate-950" onClick={() => openReceiptSms(payment)}>SMS</button>
                )}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No payments recorded yet.
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  brand,
  edited,
}: {
  status: PaymentStatus | "Deleted";
  brand: (typeof businesses)[BusinessId];
  edited?: boolean;
}) {
  const color = status === "Paid" ? brand.success : status === "Deleted" ? brand.alert : status === "Pending" ? "#667085" : brand.alert;
  return (
    <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold" style={{ backgroundColor: `${color}18`, color }}>
      {status}
      {edited ? " Edited" : ""}
    </span>
  );
}

function IconButton({ label, icon: Icon, onClick, glow = false }: { label: string; icon: LucideIcon; onClick: () => void; glow?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300 ${glow ? "money-glow-icon" : ""}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

function daysUntilTrashPurge(payment: Pick<Payment, "deletedAt" | "updatedAt">) {
  const deletedAt = new Date(payment.deletedAt ?? payment.updatedAt).getTime();
  if (Number.isNaN(deletedAt)) return trashRetentionDays;

  const elapsedDays = Math.floor((Date.now() - deletedAt) / 86_400_000);
  return Math.max(trashRetentionDays - elapsedDays, 0);
}

function isPaymentInDateRange(dateValue: string, range: DateRangeFilter, customFrom: string, customTo: string) {
  if (range === "all") return true;

  const paymentDate = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(paymentDate.getTime())) return false;

  const current = new Date(`${today}T00:00:00`);
  let start = new Date(current);
  let end = new Date(current);

  if (range === "today") {
    start = current;
    end = current;
  } else if (range === "week") {
    const day = current.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start = new Date(current);
    start.setDate(current.getDate() + mondayOffset);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (range === "month") {
    start = new Date(current.getFullYear(), current.getMonth(), 1);
    end = new Date(current.getFullYear(), current.getMonth() + 1, 0);
  } else {
    start = customFrom ? new Date(`${customFrom}T00:00:00`) : new Date(0);
    end = customTo ? new Date(`${customTo}T00:00:00`) : new Date(8640000000000000);
  }

  return paymentDate >= start && paymentDate <= end;
}

function isCollectibleItem(item: Item | undefined, payments: Payment[]) {
  if (!item || item.balanceClosed) return false;
  return payments.some((payment) => payment.itemId === item.id && !payment.isDeleted);
}

function buildTrend(payments: EnrichedPayment[]) {
  const current = new Date(`${today}T00:00:00`);
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(current.getFullYear(), current.getMonth() - 5 + index, 1);
    const month = date.toLocaleString("en-KE", { month: "short" });
    const year = date.getFullYear();
    const monthNumber = date.getMonth() + 1;
    const income = payments
      .filter((payment) => {
        const paymentDate = new Date(payment.date);
        return paymentDate.getFullYear() === year && paymentDate.getMonth() + 1 === monthNumber;
      })
      .reduce((sum, payment) => sum + payment.amount, 0);
    return { month, income };
  });
}

function buildFollowUpLedger(
  items: Item[],
  payers: Payer[],
  payments: Payment[],
  visibleBusinessIds: BusinessId[],
): FollowUpLedger {
  const current = new Date(`${today}T00:00:00`);
  const followUps = items
    .filter((item) => visibleBusinessIds.includes(item.businessId))
    .filter((item) => isCollectibleItem(item, payments))
    .map((item) => {
      const payer = payers.find((entry) => entry.id === item.payerId);
      const itemPayments = payments
        .filter((payment) => payment.itemId === item.id && !payment.isDeleted)
        .sort((a, b) => b.date.localeCompare(a.date));
      const paid = itemPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const balance = Math.max(item.totalAmount - paid, 0);
      const due = new Date(`${item.dueDate}T00:00:00`);
      const daysUntilDue = Math.ceil((due.getTime() - current.getTime()) / 86_400_000);
      const status: FollowUpStatus = daysUntilDue < 0 ? "overdue" : daysUntilDue <= 14 ? "due-soon" : "scheduled";

      return {
        id: item.id,
        businessId: item.businessId,
        payerName: payer?.fullName ?? "Unknown payer",
        phone: payer?.phone ?? "",
        email: payer?.email ?? "",
        itemTitle: item.title,
        dueDate: item.dueDate,
        balance,
        daysUntilDue,
        status,
        lastPaymentDate: itemPayments[0]?.date,
      };
    })
    .filter((item) => item.balance > 0)
    .sort((a, b) => {
      if (a.status !== b.status) return followUpWeight(a.status) - followUpWeight(b.status);
      return a.daysUntilDue - b.daysUntilDue;
    });

  return {
    items: followUps,
    overdueTotal: followUps.filter((item) => item.status === "overdue").reduce((sum, item) => sum + item.balance, 0),
    dueSoonTotal: followUps.filter((item) => item.status === "due-soon").reduce((sum, item) => sum + item.balance, 0),
    scheduledTotal: followUps.filter((item) => item.status === "scheduled").reduce((sum, item) => sum + item.balance, 0),
    priorityCount: followUps.filter((item) => item.status !== "scheduled").length,
  };
}

function followUpWeight(status: FollowUpStatus) {
  if (status === "overdue") return 0;
  if (status === "due-soon") return 1;
  return 2;
}

function buildConfidenceLedger(
  payments: EnrichedPayment[],
  items: Item[],
  auditLog: AuditEntry[],
  visibleBusinessIds: BusinessId[],
  formatMoney: (value: number) => string,
): ConfidenceLedger {
  const issues: ConfidenceIssue[] = [];
  const scopedPayments = payments.filter((payment) => visibleBusinessIds.includes(payment.businessId));
  const activePayments = scopedPayments.filter((payment) => !payment.isDeleted);
  const editedOrRestoredPaymentIds = new Set(
    auditLog
      .filter((entry) => entry.action === "edited" || entry.action === "restored")
      .map((entry) => entry.paymentId),
  );
  const paymentById = new Map(scopedPayments.map((payment) => [payment.id, payment]));

  activePayments.forEach((payment) => {
    if (payment.method === "M-Pesa" && !payment.mpesaCode?.trim()) {
      issues.push({
        id: `missing-mpesa-${payment.id}`,
        title: "Missing M-Pesa code",
        detail: `${payment.itemTitle} has an M-Pesa payment without a transaction code.`,
        severity: "critical",
        paymentId: payment.id,
        payerName: payment.payerName,
      });
    }

    if (payment.method === "Cash" && !payment.notes.trim()) {
      issues.push({
        id: `cash-note-${payment.id}`,
        title: "Cash payment needs notes",
        detail: "Manual cash entries should include a short receipt or handover note.",
        severity: "warning",
        paymentId: payment.id,
        payerName: payment.payerName,
      });
    }

    if (payment.edited || editedOrRestoredPaymentIds.has(payment.id)) {
      issues.push({
        id: `edited-${payment.id}`,
        title: "Edited record needs review",
        detail: "This payment has been edited or restored and should be checked before month-end close.",
        severity: "notice",
        paymentId: payment.id,
        payerName: payment.payerName,
      });
    }
  });

  const duplicateGroups = new Map<string, EnrichedPayment[]>();
  activePayments.forEach((payment) => {
    const key = `${payment.payerId}|${payment.date}|${payment.amount}`;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), payment]);
  });
  duplicateGroups.forEach((group) => {
    if (group.length < 2) return;
    group.forEach((payment) => {
      issues.push({
        id: `duplicate-${payment.id}`,
        title: "Possible duplicate payment",
        detail: `${formatMoney(payment.amount)} appears more than once for this payer on ${dateFmt.format(new Date(payment.date))}.`,
        severity: "warning",
        paymentId: payment.id,
        payerName: payment.payerName,
      });
    });
  });

  items
    .filter((item) => visibleBusinessIds.includes(item.businessId))
    .filter((item) => !item.balanceClosed)
    .forEach((item) => {
      const itemPayments = activePayments.filter((payment) => payment.itemId === item.id);
      const paid = itemPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const balance = item.totalAmount - paid;
      const representativePayment = itemPayments[0];

      if (paid > item.totalAmount) {
        issues.push({
          id: `overpaid-${item.id}`,
          title: "Payment exceeds balance",
          detail: `${item.title} is overpaid by ${formatMoney(paid - item.totalAmount)}.`,
          severity: "critical",
          paymentId: representativePayment?.id,
          itemId: item.id,
          payerName: representativePayment?.payerName,
        });
      }

      if (balance > 0 && item.dueDate && item.dueDate < today) {
        issues.push({
          id: `overdue-${item.id}`,
          title: "Outstanding balance past due",
          detail: `${item.title} still has ${formatMoney(balance)} due after ${dateFmt.format(new Date(item.dueDate))}.`,
          severity: "warning",
          paymentId: representativePayment?.id,
          itemId: item.id,
          payerName: representativePayment?.payerName,
        });
      }
    });

  const byPaymentId = issues.reduce<Record<string, ConfidenceIssue[]>>((groups, issue) => {
    if (!issue.paymentId || !paymentById.has(issue.paymentId)) return groups;
    groups[issue.paymentId] = [...(groups[issue.paymentId] ?? []), issue];
    return groups;
  }, {});

  const penalty = issues.reduce((sum, issue) => {
    if (issue.severity === "critical") return sum + 12;
    if (issue.severity === "warning") return sum + 7;
    return sum + 4;
  }, 0);

  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    cleanCount: Math.max(activePayments.length - Object.keys(byPaymentId).length, 0),
    issueCount: issues.length,
    issues: issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity)),
    byPaymentId,
  };
}

function severityWeight(severity: ConfidenceSeverity) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function confidenceColor(severity: ConfidenceSeverity) {
  if (severity === "critical") return "#B5533C";
  if (severity === "warning") return "#C4665A";
  return "#3B4E8C";
}

export default App;
