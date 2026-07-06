import type { AppData, StorageBackend } from "./types";

const STORAGE_KEY = "sam-creative-paytrack-state-v1";
const SNAPSHOT_ID = "primary";

export const defaultAppData: AppData = {
  payers: [],
  items: [],
  payments: [],
  auditLog: [],
};

type PersistResult = {
  backend: StorageBackend;
  error?: string;
};

type SupabaseSnapshot = {
  payload: AppData;
};

type LoadResult = {
  data: AppData;
  backend: StorageBackend;
  error?: string;
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
    items: Array.isArray(data?.items) ? data.items : defaultAppData.items,
    payments: Array.isArray(data?.payments) ? data.payments : defaultAppData.payments,
    auditLog: Array.isArray(data?.auditLog) ? data.auditLog : defaultAppData.auditLog,
  };
}

function loadBrowserData(): AppData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw) as Partial<AppData>) : defaultAppData;
  } catch {
    return defaultAppData;
  }
}

function saveBrowserData(data: AppData) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

async function loadSupabaseData(): Promise<AppData | null> {
  if (!canUseSupabase()) return null;

  const response = await fetch(
    `${supabaseUrl}/rest/v1/app_state_snapshots?id=eq.${SNAPSHOT_ID}&select=payload`,
    { headers: headers() },
  );

  if (!response.ok) {
    throw new Error(`Supabase load failed (${response.status})`);
  }

  const rows = (await response.json()) as SupabaseSnapshot[];
  return rows[0]?.payload ? normalizeData(rows[0].payload) : null;
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
      const supabaseData = await loadSupabaseData();
      const data = supabaseData ?? defaultAppData;

      if (!supabaseData) {
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
  saveBrowserData(data);

  if (!canUseSupabase()) {
    return { backend: "browser", error: "Supabase is not configured" };
  }

  try {
    await saveSupabaseData(data);
    return { backend: "supabase" };
  } catch (error) {
    return {
      backend: "browser",
      error: error instanceof Error ? error.message : "Supabase save failed",
    };
  }
}
