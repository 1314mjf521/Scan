# Workspace Notes

- Frontend: React, TypeScript, Vite. Backend: Express 5, TypeScript, SQLite.
- Run `npm run dev` for local development, `npm run build` for production validation, and `npm run typecheck:server` for API type checks.
- Keep inventory mutations and administrator authorization in `server/index.ts`; never expose `admin_audit` through public API routes.
- Store local secrets in `.env` and database files under `data/`; do not commit either.
