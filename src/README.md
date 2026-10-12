# CampusFind — GitHub + Vercel edition

CampusFind is a responsive campus lost-and-found website. This repository keeps local VS Code development and adds a Vercel deployment path with durable Neon PostgreSQL data, private Vercel Blob image storage, Gemini image recognition, and password-protected administrator actions.

## Features

- Lost-item and found-item reporting with photo uploads
- Weighted matching by category, location, description, date, and available visual profile
- Gemini visual analysis for uploaded item photos
- A separate Recovered Items handover register
- Gemini extraction of student name, roll number, and course from permitted ID-card photos
- Durable cloud data with Neon PostgreSQL when deployed on Vercel
- Private Blob storage for uploaded photos; ID-card photos can be retrieved only through the admin-protected recovery endpoint
- Administrator password required for the recovery register, ID photos, report deletion, and clearing reports on Vercel

## Deploy with GitHub + Vercel

### 1. Upload the project to GitHub

1. Download and extract this project ZIP.
2. Create a new repository on GitHub.
3. Upload the **contents** of the extracted folder to the repository root. Do not upload the ZIP file itself.
4. Do not commit `.env`, real student data, or uploaded photos. `.gitignore` already excludes these.

### 2. Create a Neon database

1. Create a PostgreSQL project at <https://neon.tech/>.
2. Copy the database connection string from Neon.
3. The app creates its two tables automatically at first API use; no manual SQL migration is required.

### 3. Create a private Vercel Blob store

1. Open your Vercel dashboard and create a **private** Blob store for CampusFind.
2. Copy its read-write token. The backend stores both item photos and ID-card photos privately; the app serves ordinary item photos through a public read endpoint and requires admin sign-in for ID-card photos.

### 4. Import/connect the GitHub repository in Vercel

1. Open the existing `campusfind-lost-and-found` Vercel project, or create a new project by importing the GitHub repository.
2. Connect the GitHub repository and use the repository root as the project root.
3. `vercel.json` points Vercel at `public/` for static files and configures the API catch-all function. No frontend build command is needed.
4. Add the environment variables listed below for **Production** (and Preview if needed).
5. Deploy. Later pushes to your connected deployment branch will redeploy the site automatically.

### 5. Configure Vercel environment variables

In **Vercel → Project → Settings → Environment Variables**, add:

| Name | Required? | Value |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `BLOB_READ_WRITE_TOKEN` | Yes | Read-write token from the private Vercel Blob store |
| `CAMPUSFIND_ADMIN_PASSWORD` | Yes | A long, unique administrator password |
| `CAMPUSFIND_SESSION_SECRET` | Yes | At least 32 random bytes, hex encoded |
| `GEMINI_API_KEY` | Optional | Google AI Studio API key for Gemini image/ID analysis |
| `GEMINI_MODEL` | Optional | `gemini-3.5-flash-lite` |

Generate a session secret locally with Node.js:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the printed value directly into `CAMPUSFIND_SESSION_SECRET` in Vercel. Do not commit these secrets into GitHub or put them in frontend JavaScript. Redeploy after changing environment variables.

## Run locally in VS Code

Requirements: Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open <http://localhost:3000>. The local mode saves test data to `data/` and photos to `uploads/`, so Neon and Vercel Blob are not required for local development. Add `GEMINI_API_KEY` in `.env` only if you want Gemini features locally.

Run tests:

```powershell
node --test
```

## Privacy and operational notes

- The Recovered Items register, its ID-card photos, report deletion, and Clear All action require administrator sign-in in Vercel mode. Sessions expire after eight hours.
- Lost/found reports are currently public. Reporter names and mobile numbers are visible on the board by design. Obtain consent and do not use real student data until your institution approves the workflow and privacy notice.
- The admin password is shared by the designated staff team; this is a simple administrator gate, not per-user identity management or an audit log. Add institution-approved authentication and rate limiting before broad production use.
- Gemini receives uploaded item photos for image analysis. When the administrator explicitly selects ID extraction, the two ID-card images are sent to Google's Gemini API to extract only name, roll number, and course according to the prompt in `lib/vision.js`.
- Existing data from the old local JSON project does not automatically migrate to Neon; local files are not deployed as live database records.

## Repository layout

- `public/` — browser UI, JavaScript, and CSS
- `api/[...path].js` — Vercel catch-all serverless function
- `server.js` — shared Express API (local + Vercel)
- `lib/cloud-storage.js` — Neon database and private Blob integration
- `lib/matcher.js` — report matching logic
- `lib/vision.js` — Gemini image recognition and ID extraction
- `vercel.json` — Vercel static output/function configuration
- `.env.example` — variable names for local setup
