# CampusFind — Campus Lost & Found

This repository contains the CampusFind website and a GitHub Actions workflow that deploys it to the existing Vercel project `campusfind-lost-and-found`.

## First run: unpack the source

The original project is stored temporarily as compressed pieces under `bundle/`. The **Deploy CampusFind to Vercel** workflow reconstructs the full project into `src/` and commits those normal source files to GitHub the first time it runs. After that, `src/` is the editable website source: `src/server.js`, `src/public/`, `src/lib/`, `src/api/`, `src/package.json`, and `src/vercel.json`.

The first workflow run can stop at the token check if `VERCEL_TOKEN` has not yet been added. It still unpacks and commits `src/` before that check.

## 1. Add the Vercel token to GitHub

In this repository, go to **Settings → Secrets and variables → Actions → New repository secret**. Create:

- **Name:** `VERCEL_TOKEN`
- **Value:** the token you create in your Vercel account settings.

Do not write the token into a repository file. You may rerun the workflow manually from **Actions → Deploy CampusFind to Vercel → Run workflow** after saving the secret.

The workflow also deploys automatically after pushes to `main`.

## 2. Configure database and image storage

Create a PostgreSQL database using [Neon](https://neon.tech/) and create a **private** Blob store in Vercel. Then open Vercel **Project → campusfind-lost-and-found → Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `BLOB_READ_WRITE_TOKEN` | Read-write token for the private Vercel Blob store |
| `CAMPUSFIND_ADMIN_PASSWORD` | A long, unique administrator password |
| `CAMPUSFIND_SESSION_SECRET` | At least 32 random bytes encoded as hexadecimal |
| `GEMINI_API_KEY` | Optional Google AI Studio key for image recognition and student ID extraction |
| `GEMINI_MODEL` | Optional; defaults to `gemini-3.5-flash-lite` |

Generate the session secret with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the required variables to Production (and Preview if you plan to use previews). The application creates its two database tables automatically on first API use. Vercel runtime data will not persist on a local filesystem, so Neon and Blob are required for cloud operation.

## 3. Edit/run locally

After the first workflow has created `src/`, open that folder in VS Code and run:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000. Locally, the app saves development records to `src/data/` and photos to `src/uploads/`. Add `GEMINI_API_KEY` to `.env` only if you want Gemini features locally. Run the matching tests with `node --test`.

## Features

- Lost and found reports with photos.
- Weighted matching by category, location, description, date, and optional AI-derived photo features.
- Gemini item image analysis.
- A separate Recovered Items handover register with student details and ID-card photos.
- Neon PostgreSQL persistence and private Vercel Blob uploads on Vercel.
- Administrator password protection for recovered records, ID-card photos, report deletion, and Clear All.

## Privacy notes

Lost/found reports are public, including reporter names and mobile numbers. Recovery history, ID-card photos, report deletion, and Clear All require the administrator password. This shared-password gate is not individual staff identity management or an audit log. Use sample data until your institution approves the workflow and privacy notice. Do not commit `.env`, tokens, passwords, real student records, or ID-card photos.
