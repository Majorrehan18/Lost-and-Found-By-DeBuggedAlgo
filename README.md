# CampusFind — Campus Lost & Found

The application source is in **`src/`**. The Vercel project `lost-and-found` is configured to use `src/` as its Root Directory, and Vercel's Git integration deploys pushes to `main`.

## Start locally

Open `src/` in VS Code, then run:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Visit http://localhost:3000. Run tests with `node --test` inside `src/`.

## Production setup

Production uses a connected **private Vercel Blob store** for durable report records and uploaded photos. The Blob token is provisioned by Vercel when the store is connected. Administrator-only features also require `CAMPUSFIND_ADMIN_PASSWORD` and `CAMPUSFIND_SESSION_SECRET` in Vercel Environment Variables. Gemini features are optional and use `GEMINI_API_KEY`.

See [the application README](src/README.md) for details about deployment, environment variables, and privacy considerations.

Do not commit credentials, `.env` files, real student data, or uploaded photos.
