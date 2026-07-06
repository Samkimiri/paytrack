import type { AppData, StorageBackend } from "./types";

const STORAGE_KEY = "sam-creative-paytrack-state-v1";
const SNAPSHOT_ID = "primary";
const TRASH_RETENTION_DAYS = 30;

export const defaultAppData: AppData = {
  payers: [],
  items: [],
  payments: [],
  auditLog: [],
  roles: { admin: "admin" },
};

type PersistResult = {
  backend: StorageBackend;
  error?: string;
  savedAt: string;
};

type SupabaseSnapshot = {
  payload: AppData;
  updated_at?: string;
};

type LoadResult = {
  data: AppData;
  backend: StorageBackend;
  error?: string;
  savedAt?: string;
};

const legacyDemoIds = new Set([
  "p-001",
  "p-002",
  "p-003",
  "p-004",
  "i-001",
  "i-002",
  "i-003",
  "i-004",
  "pay-001",
  "pay-002",
  "pay-003",
  "pay-004",
  "a-001",
  "a-002",
  "a-003",
]);

const legacyDemoNames = new Set([
  "Amina Otieno",
  "Brian Mwangi",
  "Nia Naturals Ltd",
  "Karibu Foods",
]);

type SanitizedData = {
  data: AppData;
  changed: boolean;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function canUseSupabase() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function headers() {
  return {
    apikey: supabaseAnonKey ?? "",
    Authorization: `Bearer ${supabaseAnonKey ?? ""}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };
}

function normalizeData(data: Partial<AppData> | null | undefined): AppData {
  return {
    payers: Array.isArray(data?.payers) ? data.payers : defaultAppData.payers,
    items: Array.isArray(data?.items)
      ? data.items.map((item) => ({
          ...item,
          installmentCount: Number(item.installmentCount ?? 1),
          installmentAmount: Number(item.installmentAmount ?? item.totalAmount ?? 0),
          installmentFrequency: item.installmentFrequency ?? "once",
          balanceClosed: Boolean(item.balanceClosed),
          balanceClosedAt: item.balanceClosedAt,
          balanceClosedReason: item.balanceClosedReason,
        }))
      : defaultAppData.items,
    payments: Array.isArray(data?.payments) ? data.payments : defaultAppData.payments,
    auditLog: Array.isArray(data?.auditLog) ? data.auditLog : defaultAppData.auditLog,
    roles: data?.roles && typeof data.roles === "object" ? data.roles : defaultAppData.roles,
  };
}

function removeLegacyDemoRecords(data: AppData): SanitizedData {
  const payers = data.payers.filter((payer) => !legacyDemoIds.has(payer.id) && !legacyDemoNames.has(payer.fullName));
  const payerIds = new Set(payers.map((payer) => payer.id));
  const items = data.items.filter((item) => !legacyDemoIds.has(item.id) && payerIds.has(item.payerId));
  const itemIds = new Set(items.map((item) => item.id));
  const payments = data.payments.filter(
    (payment) =>
      !legacyDemoIds.has(payment.id) &&
      payerIds.has(payment.payerId) &&
      itemIds.has(payment.itemId),
  );
  const paymentIds = new Set(payments.map((payment) => payment.id));
  const auditLog = data.auditLog.filter(
    (entry) => !legacyDemoIds.has(entry.id) && paymentIds.has(entry.paymentId),
  );

  const changed =
    payers.length !== data.payers.length ||
    items.length !== data.items.length ||
    payments.length !== data.payments.length ||
    auditLog.length !== data.auditLog.length;

  return {
    data: {
      payers,
      items,
      payments,
      auditLog,
      roles: data.roles,
    },
    changed,
  };
}

function purgeExpiredTrash(data: AppData): SanitizedData {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
  const payments = data.payments
    .map((payment) =>
      payment.isDeleted && !payment.deletedAt
        ? { ...payment, deletedAt: payment.updatedAt || payment.createdAt }
        : payment,
    )
    .filter((payment) => {
      if (!payment.isDeleted) return true;
      const deletedAt = payment.deletedAt ? new Date(payment.deletedAt).getTime() : 0;
      return Number.isNaN(deletedAt) || deletedAt > cutoff;
    });
  const paymentIds = new Set(payments.map((payment) => payment.id));
  const auditLog = data.auditLog.filter((entry) => paymentIds.has(entry.paymentId));
  const changed = payments.length !== data.payments.length || auditLog.length !== data.auditLog.length ||
    payments.some((payment, index) => payment !== data.payments[index]);

  return {
    data: {
      ...data,
      payments,
      auditLog,
    },
    changed,
  };
}

function sanitizeData(data: AppData): SanitizedData {
  const withoutDemo = removeLegacyDemoRecords(data);
  const withoutExpiredTrash = purgeExpiredTrash(withoutDemo.data);

  return {
    data: withoutExpiredTrash.data,
    changed: withoutDemo.changed || withoutExpiredTrash.changed,
  };
}

function loadBrowserData(): AppData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const data = raw ? normalizeData(JSON.parse(raw) as Partial<AppData>) : defaultAppData;
    const sanitized = sanitizeData(data);

    if (sanitized.changed) {
      saveBrowserData(sanitized.data);
    }

    return sanitized.data;
  } catch {
    return defaultAppData;
  }
}

function saveBrowserData(data: AppData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function loadSupabaseData(): Promise<SanitizedData | null> {
  if (!canUseSupabase()) return null;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/app_state_snapshots?id=eq.${SNAPSHOT_ID}&select=payload`,
    { headers: headers() },
  );

  if (!response.ok) {
    throw new Error(`Supabase load failed (${response.status})`);
  }

  const rows = (await response.json()) as SupabaseSnapshot[];
  return rows[0]?.payload ? sanitizeData(normalizeData(rows[0].payload)) : null;
}

async function saveSupabaseData(data: AppData): Promise<void> {
  if (!canUseSupabase()) return;

  const response = await fetch(`${supabaseUrl}/rest/v1/app_state_snapshots?on_conflict=id`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      id: SNAPSHOT_ID,
      payload: data,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed (${response.status})`);
  }
}

export async function loadAppData(): Promise<LoadResult> {
  if (canUseSupabase()) {
    try {
      const supabaseResult = await loadSupabaseData();
      const data = supabaseResult?.data ?? defaultAppData;

      if (!supabaseResult || supabaseResult.changed) {
        await saveSupabaseData(data);
      }

      saveBrowserData(data);
      return { data, backend: "supabase" };
    } catch (error) {
      return {
        data: loadBrowserData(),
        backend: "browser",
        error: error instanceof Error ? error.message : "Supabase load failed",
      };
    }
  }

  return { data: loadBrowserData(), backend: "browser" };
}

export async function saveAppData(data: AppData): Promise<PersistResult> {
  const sanitized = sanitizeData(data).data;
  const savedAt = new Date().toISOString();
  saveBrowserData(sanitized);

  if (!canUseSupabase()) {
    return { backend: "browser", error: "Supabase is not configured", savedAt };
  }

  try {
    await saveSupabaseData(sanitized);
    return { backend: "supabase", savedAt };
  } catch (error) {
    return {
      backend: "browser",
      error: error instanceof Error ? error.message : "Supabase save failed",
      savedAt,
    };
  }
}
