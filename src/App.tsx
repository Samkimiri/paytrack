import { FormEvent, Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArchiveRestore,
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Download,
  FileText,
  LayoutDashboard,
  Mail,
  Menu,
  MessageCircle,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
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
            <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} tickLine={false} axisLine={false} width={48} />
            <Tooltip formatter={(value) => money.format(Number(value))} />
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

function buildPaymentMessage({ payer, item, payment }: PaymentNotificationDetails) {
  const business = businesses[payment.businessId];
  const balance = Math.max(item.totalAmount - payment.amount, 0);
  const lines = [
    `Hello ${payer.fullName},`,
    `We have received your payment of ${money.format(payment.amount)} for ${item.title}.`,
    `Payment method: ${payment.method}`,
    payment.mpesaCode ? `M-Pesa code: ${payment.mpesaCode}` : "",
    `Payment date: ${payment.date}`,
    `Balance: ${money.format(balance)}`,
    "",
    `Thank you, ${business.name}.`,
  ];

  return lines.filter(Boolean).join("\n");
}

function openPaymentNotifications(details: PaymentNotificationDetails) {
  const message = buildPaymentMessage(details);
  const subject = `Payment received - ${details.item.title}`;
  const whatsappPhone = normalizeWhatsAppPhone(details.payer.phone);

  if (whatsappPhone) {
    window.open(`https://wa.me/${whatsappPhone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  if (details.payer.email) {
    const gmailUrl = new URL("https://mail.google.com/mail/");
    gmailUrl.searchParams.set("view", "cm");
    gmailUrl.searchParams.set("fs", "1");
    gmailUrl.searchParams.set("to", details.payer.email);
    gmailUrl.searchParams.set("su", subject);
    gmailUrl.searchParams.set("body", message);
    window.open(gmailUrl.toString(), "_blank", "noopener,noreferrer");
  }
}

const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "payments", label: "Payments", icon: ReceiptText },
  { id: "payers", label: "Clients/Students", icon: UsersRound },
  { id: "add", label: "Add Payment", icon: Plus },
  { id: "trash", label: "Trash", icon: Trash2 },
  { id: "reports", label: "Reports", icon: FileText },
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
  amount: string;
  method: PaymentMethod;
  mpesaCode: string;
  date: string;
  notes: string;
};

const today = new Date().toISOString().slice(0, 10);
const trashRetentionDays = 30;

function App() {
  const [scope, setScope] = useState<BusinessScope>("combined");
  const [view, setView] = useState<View>(() =>
    new URLSearchParams(window.location.search).get("action") === "add-payment" ? "add" : "dashboard",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [payers, setPayers] = useState<Payer[]>(defaultAppData.payers);
  const [items, setItems] = useState<Item[]>(defaultAppData.items);
  const [payments, setPayments] = useState<Payment[]>(defaultAppData.payments);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(defaultAppData.auditLog);
  const [hydrated, setHydrated] = useState(false);
  const [storageBackend, setStorageBackend] = useState<StorageBackend>("browser");
  const [saveState, setSaveState] = useState<"loading" | "saved" | "saving" | "error">("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | PaymentMethod>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const activeBrand = scope === "graphics" ? businesses.graphics : businesses.scds;
  const visibleBusinessIds = scope === "combined" ? (["scds", "graphics"] as BusinessId[]) : [scope];

  const enrichedPayments = useMemo(
    () =>
      payments.map((payment) => {
        const payer = payers.find((entry) => entry.id === payment.payerId);
        const item = items.find((entry) => entry.id === payment.itemId);
        const activePaid = payments
          .filter((entry) => entry.itemId === payment.itemId && !entry.isDeleted)
          .reduce((sum, entry) => sum + entry.amount, 0);
        return {
          ...payment,
          payerName: payer?.fullName ?? "Unknown payer",
          itemTitle: item?.title ?? "Unassigned item",
          businessName: businesses[payment.businessId].shortName,
          balance: Math.max((item?.totalAmount ?? 0) - activePaid, 0),
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
          const haystack = `${payment.payerName} ${payment.itemTitle} ${payment.mpesaCode ?? ""}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        })
        .filter((payment) => (methodFilter === "all" ? true : payment.method === methodFilter))
        .filter((payment) => (statusFilter === "all" ? true : payment.status === statusFilter))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [enrichedPayments, methodFilter, query, statusFilter, visibleBusinessIds],
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
  const outstanding = items
    .filter((item) => visibleBusinessIds.includes(item.businessId))
    .reduce((sum, item) => {
      const paid = payments
        .filter((payment) => payment.itemId === item.id && !payment.isDeleted)
        .reduce((innerSum, payment) => innerSum + payment.amount, 0);
      return sum + Math.max(item.totalAmount - paid, 0);
    }, 0);

  const trend = buildTrend(activePayments);
  const selectedPayer = selectedPayerId ? payers.find((payer) => payer.id === selectedPayerId) : null;
  const confidenceLedger = useMemo(
    () => buildConfidenceLedger(enrichedPayments, items, auditLog, visibleBusinessIds),
    [auditLog, enrichedPayments, items, visibleBusinessIds],
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
      saveAppData({ payers, items, payments, auditLog }).then(({ backend, error }) => {
        setStorageBackend(backend);
        setStorageError(error ?? null);
        setSaveState(error ? "error" : "saved");
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [auditLog, hydrated, items, payers, payments]);

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

  function addPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const state = Object.fromEntries(formData.entries()) as Record<string, string>;
    const businessId = state.businessId as BusinessId;
    let payerId = state.payerId;
    const amount = Number(state.amount);
    const totalDue = Number(state.totalDue);
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

  function softDelete(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: true, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    recordAudit(payment.id, "deleted", ["is_deleted", "deleted_at"], { is_deleted: false, deleted_at: payment.deletedAt });
  }

  function restorePayment(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: false, deletedAt: undefined, updatedAt: new Date().toISOString() }
          : entry,
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
    rows.forEach(([label, value], index) => {
      const y = 70 + index * 10;
      doc.setTextColor("#667085");
      doc.text(label, 18, y);
      doc.setTextColor("#172033");
      doc.text(value, 74, y);
    });
    doc.setDrawColor(brand.accent);
    doc.line(18, 170, 192, 170);
    doc.setTextColor("#667085");
    doc.text("Generated by Sam Creative Payment Tracker", 18, 184);
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

  return (
    <div className="min-h-screen transition-colors" style={{ backgroundColor: activeBrand.light }}>
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
                    setView(id);
                    setMobileOpen(false);
                  }}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>

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
              <button
                onClick={() => setView("add")}
                className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={{ backgroundColor: activeBrand.accent }}
              >
                <Plus className="h-4 w-4" />
                Add Payment
              </button>
            </div>
          </header>

          <div className="px-4 py-6 lg:px-8">
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
                onExportFollowUps={exportFollowUps}
                onPrint={printReceipt}
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
                payments={scopedPayments}
                confidenceLedger={confidenceLedger}
                onDelete={softDelete}
                onPrint={printReceipt}
                onExport={exportCsv}
              />
            )}
            {view === "trash" && (
              <TrashView
                activeBrand={activeBrand}
                payments={trashPayments}
                onRestore={restorePayment}
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
              />
            )}
            {view === "add" && (
              <AddPaymentView
                activeBrand={activeBrand}
                scope={scope}
                payers={payers}
                savedFlash={savedFlash}
                onSubmit={addPayment}
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
              />
            )}
            {view === "settings" && <SettingsView activeBrand={activeBrand} />}
          </div>
        </main>
      </div>
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
  onExportFollowUps,
  onPrint,
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
  onExportFollowUps: () => void;
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Collected" value={money.format(totalCollected)} icon={Banknote} color={activeBrand.accent} />
        <MetricCard label="Outstanding Balance" value={money.format(outstanding)} icon={Activity} color={activeBrand.alert} />
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
          <CompactPayments payments={recent} onPrint={onPrint} />
        </Panel>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ConfidencePanel ledger={confidenceLedger} activeBrand={activeBrand} />
        <FollowUpPanel ledger={followUpLedger} activeBrand={activeBrand} onExport={onExportFollowUps} />
      </section>
    </div>
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
  payments: EnrichedPayment[];
  confidenceLedger: ConfidenceLedger;
  onDelete: (payment: Payment) => void;
  onPrint: (payment: EnrichedPayment) => void | Promise<void>;
  onExport: () => void;
}) {
  return (
    <Panel title="Payment Records" icon={ReceiptText} action={<IconButton label="Export CSV" icon={Download} onClick={props.onExport} />}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_180px_180px]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="Search payer, item, or M-Pesa code"
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
            {props.payments.length ? (
              props.payments.map((payment) => (
                <tr key={payment.id} className={`border-b border-slate-100 ${payment.isDeleted ? "bg-rose-50/70 text-slate-500" : "bg-white"}`}>
                  <td className="px-3 py-3 tabular">{dateFmt.format(new Date(payment.date))}</td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-950">{payment.payerName}</p>
                    <PaymentConfidenceBadge issues={props.confidenceLedger.byPaymentId[payment.id] ?? []} />
                  </td>
                  <td className="px-3 py-3">{payment.businessName}</td>
                  <td className="px-3 py-3">{payment.itemTitle}</td>
                  <td className="px-3 py-3 font-semibold tabular">{money.format(payment.amount)}</td>
                  <td className="px-3 py-3">{payment.method}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={payment.status} brand={props.activeBrand} edited={payment.edited} />
                  </td>
                  <td className="px-3 py-3 tabular">{money.format(payment.balance)}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1">
                      <IconButton label="Print receipt" icon={Printer} onClick={() => props.onPrint(payment)} />
                      <IconButton label="Move to trash" icon={Trash2} onClick={() => props.onDelete(payment)} />
                    </div>
                  </td>
                </tr>
              ))
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
                    <td className="px-3 py-3 font-semibold tabular">{money.format(payment.amount)}</td>
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
}: {
  activeBrand: (typeof businesses)[BusinessId];
  payers: Payer[];
  items: Item[];
  payments: Payment[];
  selectedPayer: Payer | null | undefined;
  setSelectedPayerId: (id: string) => void;
  auditLog: AuditEntry[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Panel title="Payer Profiles" icon={UsersRound}>
        <div className="space-y-3">
          {payers.length ? payers.map((payer) => {
            const payerItems = items.filter((item) => item.payerId === payer.id);
            const totalDue = payerItems.reduce((sum, item) => sum + item.totalAmount, 0);
            const paid = payments
              .filter((payment) => payment.payerId === payer.id && !payment.isDeleted)
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
                <p className="mt-2 text-sm text-slate-500">{payer.email}</p>
                <div className="mt-3 flex justify-between text-sm tabular">
                  <span>{money.format(paid)} paid</span>
                  <span style={{ color: activeBrand.alert }}>{money.format(Math.max(totalDue - paid, 0))} due</span>
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
          <ProfileDetails payer={selectedPayer} items={items} payments={payments} auditLog={auditLog} activeBrand={activeBrand} />
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
  onSubmit,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scope: BusinessScope;
  payers: Payer[];
  savedFlash: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const defaultBusiness = scope === "graphics" ? "graphics" : "scds";
  const [form, setForm] = useState<FormState>({
    businessId: defaultBusiness,
    payerId: "",
    newPayerName: "",
    newPayerPhone: "",
    newPayerEmail: "",
    itemTitle: "",
    totalDue: "",
    amount: "",
    method: "M-Pesa",
    mpesaCode: "",
    date: today,
    notes: "",
  });
  const balance = Math.max(Number(form.totalDue || 0) - Number(form.amount || 0), 0);
  const businessPayers = payers.filter((payer) => payer.businessId === form.businessId);

  return (
    <Panel title="Add Payment" icon={Plus}>
      {savedFlash && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Payment saved. WhatsApp and Gmail compose windows were opened when contact details were available.
        </div>
      )}
      <form
        onSubmit={onSubmit}
        className="grid gap-4 lg:grid-cols-2"
        onChange={(event) => {
          const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          setForm((current) => ({ ...current, [target.name]: target.value }));
        }}
      >
        <Field label="Business">
          <select name="businessId" defaultValue={defaultBusiness} className="input">
            <option value="scds">Sam Creative Design School</option>
            <option value="graphics">Sam Creative Graphics</option>
          </select>
        </Field>
        <Field label="Existing payer">
          <select name="payerId" className="input" required={!form.newPayerName}>
            <option value="">Select payer or add new below</option>
            {businessPayers.map((payer) => (
              <option key={payer.id} value={payer.id}>{payer.fullName}</option>
            ))}
          </select>
        </Field>
        <Field label="New payer name">
          <input name="newPayerName" className="input" placeholder="Optional" />
        </Field>
        <Field label="New payer phone">
          <input name="newPayerPhone" className="input" placeholder="+254 ..." />
        </Field>
        <Field label="New payer email">
          <input name="newPayerEmail" type="email" className="input" placeholder="name@example.com" />
        </Field>
        <Field label="Course or project">
          <input name="itemTitle" className="input" required placeholder="Course/project name" />
        </Field>
        <Field label="Total amount due">
          <input name="totalDue" type="number" min="0" className="input tabular" required />
        </Field>
        <Field label="Amount paid now">
          <input name="amount" type="number" min="0" className="input tabular" required />
        </Field>
        <Field label="Payment method">
          <select name="method" className="input">
            <option>M-Pesa</option>
            <option>Cash</option>
            <option>Bank Transfer</option>
          </select>
        </Field>
        {form.method === "M-Pesa" && (
          <Field label="M-Pesa transaction code">
            <input name="mpesaCode" className="input uppercase" placeholder="TH..." />
          </Field>
        )}
        <Field label="Payment date">
          <input name="date" type="date" defaultValue={today} className="input tabular" />
        </Field>
        <Field label="Due date">
          <input name="dueDate" type="date" defaultValue={today} className="input tabular" />
        </Field>
        <div className="lg:col-span-2">
          <Field label="Notes">
            <textarea name="notes" rows={4} className="input resize-y" />
          </Field>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase text-slate-500">Calculated balance</p>
          <p className="mt-1 text-2xl font-semibold tabular" style={{ color: balance === 0 ? activeBrand.success : activeBrand.alert }}>
            {money.format(balance)}
          </p>
        </div>
        <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <MessageCircle className="h-4 w-4" />
            <Mail className="h-4 w-4" />
            Auto message
          </div>
          <p className="mt-2">Saving opens WhatsApp and Gmail with a ready payment confirmation for the payer.</p>
        </div>
        <div className="flex items-end justify-end">
          <button
            className="inline-flex items-center gap-2 rounded px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{ backgroundColor: activeBrand.accent }}
          >
            <Plus className="h-4 w-4" />
            Save Payment
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
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scopedPayments: EnrichedPayment[];
  trend: TrendPoint[];
  followUpLedger: FollowUpLedger;
  onExport: () => void;
  onExportFollowUps: () => void;
}) {
  const byBusiness = Object.values(businesses).map((business) => ({
    business,
    total: scopedPayments
      .filter((payment) => payment.businessId === business.id && !payment.isDeleted)
      .reduce((sum, payment) => sum + payment.amount, 0),
  }));
  return (
    <div className="space-y-6">
      <Panel title="Statements & Export" icon={FileText} action={<IconButton label="Download CSV" icon={Download} onClick={onExport} />}>
        <div className="grid gap-4 md:grid-cols-2">
          {byBusiness.map(({ business, total }) => (
            <div key={business.id} className="rounded border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-500">{business.name}</p>
              <p className="mt-3 text-3xl font-semibold tabular" style={{ color: business.accent }}>{money.format(total)}</p>
              <p className="mt-2 text-sm text-slate-500">Current filtered collection total</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Follow-Up Export" icon={CalendarDays} action={<IconButton label="Download follow-ups" icon={Download} onClick={onExportFollowUps} />}>
        <div className="grid gap-4 md:grid-cols-3">
          <MetricMini label="Overdue" value={money.format(followUpLedger.overdueTotal)} color={activeBrand.alert} />
          <MetricMini label="Due Soon" value={money.format(followUpLedger.dueSoonTotal)} color={activeBrand.success} />
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
              <span className="text-right font-semibold tabular">{money.format(entry.income)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SettingsView({ activeBrand }: { activeBrand: (typeof businesses)[BusinessId] }) {
  return (
    <Panel title="Settings" icon={Settings}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-5">
          <p className="font-semibold text-slate-950">Supabase connection</p>
          <p className="mt-2 text-sm text-slate-500">
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then run supabase/schema.sql so records sync online.
          </p>
        </div>
        <div className="rounded border border-slate-200 bg-white p-5">
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
}: {
  payer: Payer;
  items: Item[];
  payments: Payment[];
  auditLog: AuditEntry[];
  activeBrand: (typeof businesses)[BusinessId];
}) {
  const payerItems = items.filter((item) => item.payerId === payer.id);
  const payerPayments = payments.filter((payment) => payment.payerId === payer.id && !payment.isDeleted);
  const totalDue = payerItems.reduce((sum, item) => sum + item.totalAmount, 0);
  const paid = payerPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const payerAudit = auditLog.filter((entry) => payerPayments.some((payment) => payment.id === entry.paymentId));

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricMini label="Total Due" value={money.format(totalDue)} />
        <MetricMini label="Paid" value={money.format(paid)} />
        <MetricMini label="Balance" value={money.format(Math.max(totalDue - paid, 0))} color={activeBrand.alert} />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[680px] w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr><th className="py-3">Date</th><th>Item</th><th>Amount</th><th>Status</th><th>Method</th></tr>
          </thead>
          <tbody>
            {payerPayments.map((payment) => {
              const item = items.find((entry) => entry.id === payment.itemId);
              return (
                <tr key={payment.id} className="border-b border-slate-100">
                  <td className="py-3 tabular">{dateFmt.format(new Date(payment.date))}</td>
                  <td>{item?.title}</td>
                  <td className="font-semibold tabular">{money.format(payment.amount)}</td>
                  <td><StatusBadge status={payment.status} brand={activeBrand} edited={payment.edited} /></td>
                  <td>{payment.method}</td>
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
  const priorityItems = ledger.items.filter((item) => item.status !== "scheduled").slice(0, 5);

  return (
    <Panel title="Follow-Up & Cashflow Watchlist" icon={CalendarDays} action={<IconButton label="Export follow-ups" icon={Download} onClick={onExport} />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricMini label="Overdue" value={money.format(ledger.overdueTotal)} color={activeBrand.alert} />
        <MetricMini label="Due Soon" value={money.format(ledger.dueSoonTotal)} color={activeBrand.success} />
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

function FollowUpRow({ item, activeBrand }: { item: FollowUpItem; activeBrand: (typeof businesses)[BusinessId] }) {
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
          <p className="font-semibold tabular" style={{ color }}>{money.format(item.balance)}</p>
          <p className="mt-1 text-xs font-semibold uppercase" style={{ color }}>{timing}</p>
        </div>
      </div>
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
    <div className="rounded border border-slate-200 bg-white p-5 shadow-soft" style={{ borderTopColor: color, borderTopWidth: 3 }}>
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

function CompactPayments({ payments, onPrint }: { payments: EnrichedPayment[]; onPrint: (payment: EnrichedPayment) => void | Promise<void> }) {
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
              <p className="font-semibold tabular">{money.format(payment.amount)}</p>
              <button className="text-xs font-semibold text-slate-500 hover:text-slate-950" onClick={() => onPrint(payment)}>Receipt</button>
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

function IconButton({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-300"
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
        detail: `${money.format(payment.amount)} appears more than once for this payer on ${dateFmt.format(new Date(payment.date))}.`,
        severity: "warning",
        paymentId: payment.id,
        payerName: payment.payerName,
      });
    });
  });

  items
    .filter((item) => visibleBusinessIds.includes(item.businessId))
    .forEach((item) => {
      const itemPayments = activePayments.filter((payment) => payment.itemId === item.id);
      const paid = itemPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const balance = item.totalAmount - paid;
      const representativePayment = itemPayments[0];

      if (paid > item.totalAmount) {
        issues.push({
          id: `overpaid-${item.id}`,
          title: "Payment exceeds balance",
          detail: `${item.title} is overpaid by ${money.format(paid - item.totalAmount)}.`,
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
          detail: `${item.title} still has ${money.format(balance)} due after ${dateFmt.format(new Date(item.dueDate))}.`,
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
