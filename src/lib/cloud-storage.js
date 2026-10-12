import { put, del, get, list } from "@vercel/blob";

// Private Vercel Blob is used for both uploaded photos and durable JSON records.
// This keeps cloud operation independent of a separately provisioned SQL database.
// Each report is one object. Recovery reports use the associated found-item ID as
// their pathname, so one found report cannot have two recovery records.

function requireBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    const error = new Error("Private Blob storage is not configured. Connect a private Vercel Blob store to this project and set BLOB_READ_WRITE_TOKEN.");
    error.code = "CAMPUSFIND_BLOB_NOT_CONFIGURED";
    throw error;
  }
  return token;
}

async function listRecords(prefix) {
  const token = requireBlobToken();
  const records = [];
  let cursor;

  do {
    const page = await list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
      access: "private",
      token
    });

    for (const blob of page.blobs || []) {
      if (!blob.pathname?.endsWith(".json")) continue;
      const result = await get(blob.pathname, { access: "private", token });
      if (!result || result.statusCode !== 200) continue;
      try {
        const text = await new Response(result.stream).text();
        records.push({ pathname: blob.pathname, value: JSON.parse(text) });
      } catch (error) {
        console.warn(`Skipping invalid CampusFind record ${blob.pathname}:`, error?.message || "invalid JSON");
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return records;
}

async function readJson(pathname) {
  const token = requireBlobToken();
  const result = await get(pathname, { access: "private", token });
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function writeJson(pathname, value, { allowOverwrite = true } = {}) {
  const token = requireBlobToken();
  return put(pathname, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite,
    contentType: "application/json; charset=utf-8",
    token
  });
}

async function remove(pathname) {
  const token = requireBlobToken();
  await del(pathname, { token });
}

export async function loadCloudItems() {
  const rows = await listRecords("data/items/");
  return rows.map(row => row.value).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveCloudItem(item) {
  await writeJson(`data/items/${item.id}.json`, item, { allowOverwrite: true });
}

export async function deleteCloudItem(id) {
  const pathname = `data/items/${id}.json`;
  const existing = await readJson(pathname);
  if (existing) await remove(pathname);
}

export async function clearCloudItems() {
  const rows = await listRecords("data/items/");
  await Promise.all(rows.map(row => remove(row.pathname)));
  return rows.length;
}

export async function loadCloudRecoveries() {
  const rows = await listRecords("data/recoveries/");
  return rows.map(row => row.value).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveCloudRecovery(record) {
  // Use the found report's ID as a unique storage key to prevent duplicate handovers.
  const pathname = `data/recoveries/${record.itemId}.json`;
  const existing = await readJson(pathname);
  if (existing) {
    const error = new Error("This found-item report is already recorded as recovered.");
    error.code = "23505";
    throw error;
  }

  try {
    await writeJson(pathname, record, { allowOverwrite: false });
  } catch (error) {
    // Distinguish a simultaneous duplicate submission from unrelated storage errors.
    const nowExists = await readJson(pathname).catch(() => null);
    if (nowExists) {
      const duplicate = new Error("This found-item report is already recorded as recovered.");
      duplicate.code = "23505";
      throw duplicate;
    }
    throw error;
  }
}

export async function deleteCloudRecovery(id) {
  const rows = await listRecords("data/recoveries/");
  const record = rows.find(row => String(row.value?.id) === String(id));
  if (record) await remove(record.pathname);
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
  await remove(pathname);
}
