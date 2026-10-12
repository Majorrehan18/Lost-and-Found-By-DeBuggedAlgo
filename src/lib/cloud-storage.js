import { neon } from "@neondatabase/serverless";
import { put, del, get } from "@vercel/blob";

let sqlClient;
let schemaPromise;

function getSql() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    const error = new Error("Cloud database is not configured. Add DATABASE_URL in Vercel Project Settings → Environment Variables.");
    error.code = "CAMPUSFIND_DATABASE_NOT_CONFIGURED";
    throw error;
  }
  if (!sqlClient) sqlClient = neon(connectionString);
  return sqlClient;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`CREATE TABLE IF NOT EXISTS campusfind_items (
        id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS campusfind_recovered_items (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    })().catch(error => {
      schemaPromise = undefined;
      throw error;
    });
  }
  await schemaPromise;
  return getSql();
}

function requireBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    const error = new Error("Image storage is not configured. Create a Vercel Blob store and add BLOB_READ_WRITE_TOKEN in the Vercel project environment variables.");
    error.code = "CAMPUSFIND_BLOB_NOT_CONFIGURED";
    throw error;
  }
  return token;
}

export async function loadCloudItems() {
  const sql = await ensureSchema();
  const rows = await sql`SELECT payload FROM campusfind_items ORDER BY created_at DESC`;
  return rows.map(row => row.payload);
}

export async function saveCloudItem(item) {
  const sql = await ensureSchema();
  await sql`INSERT INTO campusfind_items (id, payload, created_at)
    VALUES (${item.id}, ${JSON.stringify(item)}::jsonb, ${item.createdAt}::timestamptz)
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`;
}

export async function deleteCloudItem(id) {
  const sql = await ensureSchema();
  await sql`DELETE FROM campusfind_items WHERE id = ${id}`;
}

export async function clearCloudItems() {
  const sql = await ensureSchema();
  const rows = await sql`DELETE FROM campusfind_items RETURNING id`;
  return rows.length;
}

export async function loadCloudRecoveries() {
  const sql = await ensureSchema();
  const rows = await sql`SELECT payload FROM campusfind_recovered_items ORDER BY created_at DESC`;
  return rows.map(row => row.payload);
}

export async function saveCloudRecovery(record) {
  const sql = await ensureSchema();
  await sql`INSERT INTO campusfind_recovered_items (id, item_id, payload, created_at)
    VALUES (${record.id}, ${record.itemId}, ${JSON.stringify(record)}::jsonb, ${record.createdAt}::timestamptz)`;
}

export async function deleteCloudRecovery(id) {
  const sql = await ensureSchema();
  await sql`DELETE FROM campusfind_recovered_items WHERE id = ${id}`;
}

export async function storePrivatePhoto(folder, filename, buffer, contentType) {
  const token = requireBlobToken();
  const blob = await put(`${folder}/${filename}`, buffer, {
    access: "private",
    addRandomSuffix: false,
    contentType,
    token
  });
  return { pathname: blob.pathname, contentType, size: buffer.length };
}

export async function readPrivatePhoto(pathname) {
  const token = requireBlobToken();
  const result = await get(pathname, { access: "private", token });
  if (!result || result.statusCode !== 200) return null;
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { buffer, contentType: result.blob?.contentType || "application/octet-stream" };
}

export async function deletePrivatePhoto(pathname) {
  if (!pathname) return;
  const token = requireBlobToken();
  await del(pathname, { token });
}
