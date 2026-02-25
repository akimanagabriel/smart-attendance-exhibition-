# Database Setup Guide - Smart Campus Hub

## ✅ Prisma 7 Fix Applied

The **PrismaClientConstructorValidationError** has been resolved by:

1. **Installing PostgreSQL adapter**: `@prisma/adapter-pg` and `pg`
2. **Updating `src/config/database.ts`**: PrismaClient now uses the adapter for direct PostgreSQL connections

## Database Synchronization

### Option 1: Prisma Migrate (Recommended for Production)

When your database is reachable:

```bash
# Ensure DATABASE_URL in .env is correct
# For Supabase, use: postgresql://user:password@host:5432/postgres?sslmode=require

npm run prisma:migrate
```

This will:
- Create migration files
- Apply them to your Supabase database
- Keep a migration history

### Option 2: Prisma DB Push (Quick Sync)

For development or when you need to sync schema quickly:

```bash
npx prisma db push
```

This pushes schema changes directly without creating migration files.

### Option 3: Manual SQL (If Migrate Fails)

If you have existing tables in Supabase, you can run the SQL from Prisma Studio or Supabase SQL Editor. Generate the SQL:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

Copy the output and run it in your Supabase SQL Editor.

## Connection Troubleshooting

### Error: "Can't reach database server"

**Possible causes:**

1. **Supabase project paused** – Free tier projects pause after inactivity. Restore from Supabase Dashboard.

2. **Wrong connection string** – Get the correct URL from Supabase:
   - Dashboard → Project Settings → Database
   - Use "Connection string" → URI format

3. **SSL required** – Supabase requires SSL. Add to your URL:
   ```
   ?sslmode=require
   ```

4. **Firewall/Network** – Ensure port 5432 is not blocked.

5. **Wrong password** – Reset database password in Supabase if needed.

### Correct .env Format

```env
# Supabase connection (with SSL)
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

## Verify Setup

1. **Test connection**:
   ```bash
   npx prisma db pull
   ```
   If this succeeds, your connection works.

2. **Prisma Studio** (visual database browser):
   ```bash
   npm run prisma:studio
   ```

3. **Start server**:
   ```bash
   npm run dev
   ```

## Summary

- ✅ **PrismaClient adapter** – Fixed and working
- ⏳ **Database sync** – Run `npx prisma migrate dev` or `npx prisma db push` when database is reachable
- 📝 **Connection** – Ensure Supabase project is active and DATABASE_URL is correct
