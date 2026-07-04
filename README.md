# Sam Creative Payment Tracker

Professional full-stack payment record keeper for Sam Creative Design School and Sam Creative Graphics.

## Local Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add Supabase credentials when you are ready to connect production data.

## Backend

- `supabase/schema.sql` creates tables, views, row-level security policies, and audit triggers.
- `supabase/functions/generate_receipt` returns payment and branding data for PDF receipts.
- `supabase/functions/export_records` returns filtered records for CSV/Excel export.

Payments are never hard-deleted. The database rejects hard deletes and logs inserts, edits, soft deletes, and restores.
