# Sam Creative Payment Tracker

Professional full-stack payment record keeper for Sam Creative Design School and Sam Creative Graphics.

## Local Development

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add Appwrite credentials before deploying.

Production records sync to a single document in an Appwrite database collection. Browser storage is only a local development fallback when Appwrite credentials are missing or online sync fails.

## Backend

Uses [Appwrite](https://appwrite.io) (Databases API) to persist a single JSON snapshot of the app state:

1. Create a project at [cloud.appwrite.io](https://cloud.appwrite.io).
2. Create a Database, then a Collection inside it.
3. Add a `payload` (String, large size) and `updated_at` (Datetime, optional) attribute to the collection.
4. Grant the `Any` role Create/Read/Update permissions on the collection (no auth is used).
5. Add a Web platform under Project Settings with your dev/prod hostnames.
6. Fill in `VITE_APPWRITE_*` in `.env.local` with the endpoint, project ID, database ID, and collection ID.

Payments are never hard-deleted from the client; soft-deleted records are purged from the snapshot after 30 days.
