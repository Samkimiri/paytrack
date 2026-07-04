const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  configured: Boolean(supabaseUrl && supabaseAnonKey),
};
