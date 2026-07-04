import { FormEvent, useMemo, useState } from "react";
import jsPDF from "jspdf";
import {
  Activity,
  ArchiveRestore,
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Download,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  Printer,
  ReceiptText,
  Search,
  Settings,
  Trash2,
  Undo2,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { businesses, initialAuditLog, initialItems, initialPayers, initialPayments } from "./data";
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

const nav = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "payments", label: "Payments", icon: ReceiptText },
  { id: "payers", label: "Clients/Students", icon: UsersRound },
  { id: "add", label: "Add Payment", icon: Plus },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type View = (typeof nav)[number]["id"];

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

const today = "2026-07-04";

function App() {
  const [scope, setScope] = useState<BusinessScope>("combined");
  const [view, setView] = useState<View>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [payers, setPayers] = useState<Payer[]>(initialPayers);
  const [items, setItems] = useState<Item[]>(initialItems);
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>(initialAuditLog);
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
        .filter((payment) => {
          const haystack = `${payment.payerName} ${payment.itemTitle} ${payment.mpesaCode ?? ""}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        })
        .filter((payment) => (methodFilter === "all" ? true : payment.method === methodFilter))
        .filter((payment) => (statusFilter === "all" ? true : payment.status === statusFilter))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [enrichedPayments, methodFilter, query, statusFilter, visibleBusinessIds],
  );

  const scopedPayers = payers.filter((payer) => visibleBusinessIds.includes(payer.businessId));
  const activePayments = scopedPayments.filter((payment) => !payment.isDeleted);
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

    if (state.newPayerName.trim()) {
      payerId = crypto.randomUUID();
      setPayers((current) => [
        ...current,
        {
          id: payerId,
          businessId,
          fullName: state.newPayerName.trim(),
          phone: state.newPayerPhone,
          email: state.newPayerEmail,
          type: businessId === "scds" ? "student" : "client",
          createdAt: new Date().toISOString(),
        },
      ]);
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
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1800);
    event.currentTarget.reset();
  }

  function softDelete(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: true, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    recordAudit(payment.id, "deleted", ["is_deleted"], { is_deleted: false });
  }

  function restorePayment(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, isDeleted: false, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    recordAudit(payment.id, "restored", ["is_deleted"], { is_deleted: true });
  }

  function markEdited(payment: Payment) {
    setPayments((current) =>
      current.map((entry) =>
        entry.id === payment.id
          ? { ...entry, edited: true, notes: `${entry.notes} Updated after review.`, updatedAt: new Date().toISOString() }
          : entry,
      ),
    );
    recordAudit(payment.id, "edited", ["notes"], { notes: payment.notes });
  }

  function printReceipt(payment: EnrichedPayment) {
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
    const header = ["date", "payer", "business", "item", "amount", "method", "status", "balance", "deleted"];
    const rows = scopedPayments.map((payment) => [
      payment.date,
      payment.payerName,
      payment.businessName,
      payment.itemTitle,
      payment.amount,
      payment.method,
      payment.status,
      payment.balance,
      payment.isDeleted,
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
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Payment Records</p>
                <h1 className="mt-2 text-xl font-semibold leading-tight">Sam Creative Finance</h1>
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
                onDelete={softDelete}
                onRestore={restorePayment}
                onEdit={markEdited}
                onPrint={printReceipt}
                onExport={exportCsv}
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
                onExport={exportCsv}
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
  onPrint,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  totalCollected: number;
  outstanding: number;
  transactions: number;
  activePayers: number;
  trend: { month: string; income: number }[];
  recent: EnrichedPayment[];
  onPrint: (payment: EnrichedPayment) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Collected" value={money.format(totalCollected)} icon={Banknote} color={activeBrand.accent} />
        <MetricCard label="Outstanding Balance" value={money.format(outstanding)} icon={Activity} color={activeBrand.alert} />
        <MetricCard label="Transactions" value={String(transactions)} icon={ReceiptText} color={activeBrand.success} />
        <MetricCard label="Active Payers" value={String(activePayers)} icon={UsersRound} color={activeBrand.accent} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="6-Month Income Trend" icon={BarChart3}>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor={activeBrand.accent} stopOpacity={0.26} />
                    <stop offset="95%" stopColor={activeBrand.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#E4E7EC" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${Number(value) / 1000}k`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => money.format(Number(value))} />
                <Area type="monotone" dataKey="income" stroke={activeBrand.accent} fill="url(#incomeFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Recent Payments" icon={CalendarDays}>
          <CompactPayments payments={recent} onPrint={onPrint} />
        </Panel>
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
  onDelete: (payment: Payment) => void;
  onRestore: (payment: Payment) => void;
  onEdit: (payment: Payment) => void;
  onPrint: (payment: EnrichedPayment) => void;
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
            {props.payments.map((payment) => (
              <tr key={payment.id} className={`border-b border-slate-100 ${payment.isDeleted ? "bg-rose-50/70 text-slate-500" : "bg-white"}`}>
                <td className="px-3 py-3 tabular">{dateFmt.format(new Date(payment.date))}</td>
                <td className="px-3 py-3 font-medium text-slate-950">{payment.payerName}</td>
                <td className="px-3 py-3">{payment.businessName}</td>
                <td className="px-3 py-3">{payment.itemTitle}</td>
                <td className="px-3 py-3 font-semibold tabular">{money.format(payment.amount)}</td>
                <td className="px-3 py-3">{payment.method}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={payment.isDeleted ? "Deleted" : payment.status} brand={props.activeBrand} edited={payment.edited} />
                </td>
                <td className="px-3 py-3 tabular">{money.format(payment.balance)}</td>
                <td className="px-3 py-3">
                  <div className="flex gap-1">
                    <IconButton label="Edit" icon={Undo2} onClick={() => props.onEdit(payment)} />
                    <IconButton label="Print receipt" icon={Printer} onClick={() => props.onPrint(payment)} />
                    {payment.isDeleted ? (
                      <IconButton label="Restore" icon={ArchiveRestore} onClick={() => props.onRestore(payment)} />
                    ) : (
                      <IconButton label="Soft delete" icon={Trash2} onClick={() => props.onDelete(payment)} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
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
          {payers.map((payer) => {
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
          })}
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
          Payment saved and audit entry created.
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
  onExport,
}: {
  activeBrand: (typeof businesses)[BusinessId];
  scopedPayments: EnrichedPayment[];
  trend: { month: string; income: number }[];
  onExport: () => void;
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
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local, then run the SQL in supabase/schema.sql.
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
  const payerPayments = payments.filter((payment) => payment.payerId === payer.id);
  const totalDue = payerItems.reduce((sum, item) => sum + item.totalAmount, 0);
  const paid = payerPayments.filter((payment) => !payment.isDeleted).reduce((sum, payment) => sum + payment.amount, 0);
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
                  <td><StatusBadge status={payment.isDeleted ? "Deleted" : payment.status} brand={activeBrand} edited={payment.edited} /></td>
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

function CompactPayments({ payments, onPrint }: { payments: EnrichedPayment[]; onPrint: (payment: EnrichedPayment) => void }) {
  return (
    <div className="space-y-3">
      {payments.map((payment) => (
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
      ))}
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

function buildTrend(payments: EnrichedPayment[]) {
  const months = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];
  return months.map((month, index) => {
    const monthNumber = index + 2;
    const income = payments
      .filter((payment) => {
        const date = new Date(payment.date);
        return date.getFullYear() === 2026 && date.getMonth() + 1 === monthNumber;
      })
      .reduce((sum, payment) => sum + payment.amount, 0);
    return { month, income };
  });
}

export default App;
