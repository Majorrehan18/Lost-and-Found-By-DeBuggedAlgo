# CampusFind — Lost & Found for campus

This repository is connected to the CampusFind deployment workflow. The source code is stored in `bundle/part-00.b64` through `bundle/part-04.b64`; GitHub Actions reconstructs it, builds with the Vercel CLI, and deploys it to the existing CampusFind Vercel project.

## Before deploying

### 1. Add the Vercel GitHub Actions secret

In this repository, open **Settings → Secrets and variables → Actions → New repository secret**.

Create:

- `VERCEL_TOKEN`: a token you create in your Vercel account.

The workflow runs on pushes to `main` and can also be started manually under **Actions → Deploy CampusFind to Vercel → Run workflow**.

### 2. Set up the cloud database and image storage

Create a PostgreSQL database with [Neon](https://neon.tech/) and create a **private** Blob store in Vercel. Then open the Vercel project **campusfind-lost-and-found → Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `BLOB_READ_WRITE_TOKEN` | Read-write token for the private Vercel Blob store |
| `CAMPUSFIND_ADMIN_PASSWORD` | A long, unique administrator password |
| `CAMPUSFIND_SESSION_SECRET` | At least 32 random bytes, encoded as hexadecimal |
| `GEMINI_API_KEY` | Optional Google AI Studio key for image recognition and ID extraction |
| `GEMINI_MODEL` | Optional; defaults to `gemini-3.5-flash-lite` |

Generate a session secret on a computer with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add the required variables to Production (and Preview if you plan to use preview deployments). Do not commit any tokens, passwords, `.env` files, campus records, or ID-card pictures to this repository. The app creates its database tables automatically on first API use.

### 3. Deploy

After adding `VERCEL_TOKEN` and configuring the Vercel environment variables, push a commit to `main` or manually run the workflow. Check the result at **GitHub → Actions**.

## Features

- Lost and found item reports with photos.
- Weighted matching using category, location, description, date, and AI-derived image profiles.
- Gemini photo analysis when `GEMINI_API_KEY` is configured.
- A separate administrator-protected Recovered Items handover register.
- Private cloud storage for item images and student ID-card photos.
- Neon PostgreSQL persistence in Vercel.
- Local-development mode in the downloadable project ZIP.

## Privacy notes

Lost/found reports are public, including reporter names and mobile numbers. Recovery history, ID-card photos, report deletion, and Clear All require the administrator password. The administrator gate is shared-password protection, not individual staff accounts or an audit log. Obtain the institution's approval before storing real student details, and use sample data during development.

## Editing the source

The deploy workflow unpacks the base64-compressed source bundle into a temporary `src/` directory, then deploys that directory with the Vercel CLI. To edit code locally, use the separate `CampusFind_GitHub_Vercel.zip` project archive provided in this conversation, make changes, then replace the bundle files only after re-creating and validating the compressed source bundle.
