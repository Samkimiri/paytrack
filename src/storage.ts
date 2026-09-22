import { Client, Databases } from "appwrite";
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

type AppwriteSnapshot = {
  payload: string;
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

type SanitizedData = {
  data: AppData;
  changed: boolean;
};

const appwriteEndpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined;
const appwriteProjectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined;
const appwriteDatabaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID as string | undefined;
const appwriteCollectionId = import.meta.env.VITE_APPWRITE_COLLECTION_ID as string | undefined;

function canUseAppwrite() {
  return Boolean(appwriteEndpoint && appwriteProjectId && appwriteDatabaseId && appwriteCollectionId);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 404;
}

let databasesInstance: Databases | null = null;

function getDatabases(): Databases {
  if (!databasesInstance) {
    const client = new Client().setEndpoint(appwriteEndpoint ?? "").setProject(appwriteProjectId ?? "");
    databasesInstance = new Databases(client);
  }
  return databasesInstance;
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
  const payers = data.payers.filter((payer) => !legacyDemoIds.has(payer.id));
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
  const nowIso = new Date().toISOString();
  const payments = data.payments
    .map((payment) =>
      payment.isDeleted && !payment.deletedAt ? { ...payment, deletedAt: nowIso } : payment,
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

async function loadAppwriteData(): Promise<SanitizedData | null> {
  if (!canUseAppwrite()) return null;

  try {
    const doc = (await getDatabases().getDocument(
      appwriteDatabaseId ?? "",
      appwriteCollectionId ?? "",
      SNAPSHOT_ID,
    )) as unknown as AppwriteSnapshot;

    return doc?.payload ? sanitizeData(normalizeData(JSON.parse(doc.payload))) : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error instanceof Error ? error : new Error("Appwrite load failed");
  }
}

async function saveAppwriteData(data: AppData): Promise<void> {
  if (!canUseAppwrite()) return;

  const payload = {
    payload: JSON.stringify(data),
    updated_at: new Date().toISOString(),
  };

  try {
    await getDatabases().upsertDocument(appwriteDatabaseId ?? "", appwriteCollectionId ?? "", SNAPSHOT_ID, payload);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Appwrite save failed");
  }
}

export async function loadAppData(): Promise<LoadResult> {
  if (canUseAppwrite()) {
    try {
      const appwriteResult = await loadAppwriteData();
      const data = appwriteResult?.data ?? defaultAppData;

      if (!appwriteResult || appwriteResult.changed) {
        await saveAppwriteData(data);
      }

      saveBrowserData(data);
      return { data, backend: "appwrite" };
    } catch (error) {
      return {
        data: loadBrowserData(),
        backend: "browser",
        error: error instanceof Error ? error.message : "Appwrite load failed",
      };
    }
  }

  return { data: loadBrowserData(), backend: "browser" };
}

export async function saveAppData(data: AppData): Promise<PersistResult> {
  const sanitized = sanitizeData(data).data;
  const savedAt = new Date().toISOString();
  saveBrowserData(sanitized);

  if (!canUseAppwrite()) {
    return { backend: "browser", error: "Appwrite is not configured", savedAt };
  }

  try {
    await saveAppwriteData(sanitized);
    return { backend: "appwrite", savedAt };
  } catch (error) {
    return {
      backend: "browser",
      error: error instanceof Error ? error.message : "Appwrite save failed",
      savedAt,
    };
  }
}
