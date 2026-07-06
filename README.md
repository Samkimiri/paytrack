# Sam Creative Payment Tracker

Professional full-stack payment record keeper for Sam Creative Design School and Sam Creative Graphics.

## Local Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add Supabase credentials before deploying.

Production records sync to the `app_state_snapshots` table in Supabase. Browser storage is only a local development fallback when Supabase credentials are missing or online sync fails.

Run `supabase/schema.sql` in your Supabase SQL editor after creating the project. The schema includes rerunnable policies for the shared online app snapshot used by the deployed frontend.

## Backend

- `supabase/schema.sql` creates tables, views, row-level security policies, and audit triggers.
- `supabase/functions/generate_receipt` returns payment and branding data for PDF receipts.
- `supabase/functions/export_records` returns filtered records for CSV/Excel export.

Payments are never hard-deleted. The database rejects hard deletes and logs inserts, edits, soft deletes, and restores.
