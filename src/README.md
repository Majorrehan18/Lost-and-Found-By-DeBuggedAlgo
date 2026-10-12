# CampusFind — Campus Lost & Found

CampusFind is a responsive lost-and-found website for a campus. This repository is connected to Vercel project `lost-and-found`. The Vercel project root is `src/`; pushes to `main` are deployed by Vercel's Git integration.

## Features

- Report lost or found items, with photo uploads.
- Match lost and found reports using category, location, date, description, and optional Gemini image analysis.
- Separate administrator-protected Recovered Items handover register.
- Optional Gemini extraction of student name, roll number, and course from ID-card photos.
- Durable private Vercel Blob storage for reports, item photos, and ID-card images.
- Local JSON-file storage for VS Code development.

## Vercel deployment

### Project setup

The Vercel project must use **Root Directory: `src`** and Node.js 22.x or newer. `src/vercel.json` declares `public/` as the static output directory and configures the catch-all API function at `src/api/[...path].js`.

A private Vercel Blob store named `campusfind-private-files` has been connected to the `lost-and-found` project. The connected store provides `BLOB_READ_WRITE_TOKEN` in Production, Preview, and Development. The app uses Blob for persistent JSON report records as well as images; no separate PostgreSQL database is required.

### Required environment variables

In Vercel → **lost-and-found → Settings → Environment Variables**, set these for Production (and Preview if using preview deployments):

| Name | Required | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Yes | Automatically supplied by the connected private Blob store; don't replace it with a public token |
| `CAMPUSFIND_ADMIN_PASSWORD` | Yes for administrator features | Long, unique password used to access recovery records, ID photos, and deletion actions |
| `CAMPUSFIND_SESSION_SECRET` | Yes for administrator features | Secret with at least 32 cryptographically random bytes encoded as hex |
| `GEMINI_API_KEY` | Optional | Enables Gemini item-photo analysis and ID-card text extraction |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.5-flash-lite` |

Generate `CAMPUSFIND_SESSION_SECRET` on a machine with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit the output or any other credentials to GitHub. After changing environment variables, redeploy the project.

### Deploy

Push to `main` and check the **Deployments** tab in Vercel. Vercel's Git integration builds and deploys the connected repository. The repository intentionally does not include a separate GitHub Actions workflow that deploys with a token; this avoids duplicate/conflicting deployments.

## Run locally in VS Code

Requirements: Node.js 20 or newer.

From the `src/` folder:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000. Local reports are saved in `src/data/` and photos in `src/uploads/`. Cloud storage isn't needed for local development. Add `GEMINI_API_KEY` to `.env` only if you want AI features locally.

Run the test suite:

```powershell
node --test
```

## Important privacy notes

- Lost/found reports are public. The current UI returns the reporter's name and mobile number with report data. Get your institution's approval and privacy guidance before using real student details.
- Recovered-item records and student ID-card photos are protected by the administrator session.
- Use a unique admin password, keep API keys out of frontend code, and never commit `.env`, real student records, or uploaded photos.
- Blob persistence stores each report as a JSON object and uses a separate unique object name per recovered found-item report. It is suitable for the current small project; a relational database is preferable for a large campus rollout with concurrent edits and reporting requirements.
