import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  clearCloudItems,
  deleteCloudItem,
  deletePrivatePhoto,
  deleteCloudRecovery,
  loadCloudItems,
  loadCloudRecoveries,
  readPrivatePhoto,
  saveCloudItem,
  saveCloudRecovery,
  storePrivatePhoto
} from "./lib/cloud-storage.js";
import { analyzeImagesWithGemini, extractStudentDetailsWithGemini } from "./lib/vision.js";
import { findMatches, BASE_WEIGHTS, MIN_PERCENT } from "./lib/matcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const IS_VERCEL = process.env.VERCEL === "1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DATA_FILE = path.join(DATA_DIR, "items.json");
const RECOVERY_FILE = path.join(DATA_DIR, "recovered-items.json");
if (!IS_VERCEL) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function loadItems() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function loadRecoveryRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RECOVERY_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
let items = IS_VERCEL ? [] : loadItems();
let recoveryRecords = IS_VERCEL ? [] : loadRecoveryRecords();
function saveRecoveryRecords() {
  const temp = `${RECOVERY_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(recoveryRecords, null, 2), "utf8");
  fs.renameSync(temp, RECOVERY_FILE);
}
function saveItems() {
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(items, null, 2), "utf8");
  fs.renameSync(temp, DATA_FILE);
}
async function persistItem(item) {
  if (IS_VERCEL) return saveCloudItem(item);
  saveItems();
}
async function persistRecovery(record) {
  if (IS_VERCEL) return saveCloudRecovery(record);
  saveRecoveryRecords();
}
async function refreshCloudState(_req, _res, next) {
  if (!IS_VERCEL) return next();
  try {
    const [storedItems, storedRecoveries] = await Promise.all([loadCloudItems(), loadCloudRecoveries()]);
    items = storedItems;
    recoveryRecords = storedRecoveries;
    return next();
  } catch (error) { return next(error); }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
if (!IS_VERCEL) {
  app.use(express.static(PUBLIC_DIR));
  app.use("/uploads", express.static(UPLOAD_DIR, {
    fallthrough: false,
    index: false,
    dotfiles: "deny",
    setHeaders(res, filePath) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", path.basename(filePath).startsWith("recovered-") ? "no-store" : "public, max-age=3600");
    }
  }));
}

const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 3, fileSize: 2 * 1024 * 1024, fields: 12, fieldSize: 2000 },
  fileFilter(_req, file, cb) { allowedMime.has(file.mimetype) ? cb(null, true) : cb(new Error("Use JPG, PNG or WebP images.")); }
});
const recoveryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 2, fileSize: 2 * 1024 * 1024, fields: 10, fieldSize: 2000 },
  fileFilter(_req, file, cb) { allowedMime.has(file.mimetype) ? cb(null, true) : cb(new Error("Use JPG, PNG or WebP ID-card images.")); }
});

function todayIndia() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value <= todayIndia();
}
function cleanMobile(value) {
  let digits = String(value ?? "").replace(/[\s()+-]/g, "");
  if (digits.startsWith("0091")) digits = digits.slice(4);
  if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
function detectType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { mimeType: "image/jpeg", ext: ".jpg" };
  if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 && buffer[4] === 13 && buffer[5] === 10 && buffer[6] === 26 && buffer[7] === 10) return { mimeType: "image/png", ext: ".png" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { mimeType: "image/webp", ext: ".webp" };
  return null;
}
function mimeFromFilename(filename) {
  if (typeof filename !== "string") return "image/jpeg";
  const lower = filename.toLowerCase();
  return lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
}
function publicItem(item) {
  const { imageFiles, ...publicFields } = item;
  return {
    ...publicFields,
    images: (imageFiles || []).map(file => {
      if (file && typeof file === "object") {
        return { url: `/api/item-photo?pathname=${encodeURIComponent(file.pathname)}`, content_type: file.contentType || "image/jpeg" };
      }
      return { url: `/uploads/${encodeURIComponent(file)}`, content_type: mimeFromFilename(file) };
    })
  };
}
function publicRecoveryRecord(record) {
  const { idPhotoFiles, ...safeRecord } = record;
  return {
    ...safeRecord,
    idPhotos: (idPhotoFiles || []).map((file, index) => ({
      label: index === 0 ? "Front of student ID" : "Back of student ID",
      url: file && typeof file === "object" ? `/api/recovered-items/photo?pathname=${encodeURIComponent(file.pathname)}` : `/uploads/${encodeURIComponent(file)}`,
      content_type: file && typeof file === "object" ? (file.contentType || "image/jpeg") : mimeFromFilename(file)
    }))
  };
}
function validateIdPhotos(files) {
  const errors = [];
  if (files.length !== 2) errors.push("Upload exactly two ID-card photos: front and back.");
  const valid = [];
  let total = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], type = detectType(file.buffer);
    if (!type || type.mimeType !== file.mimetype) { errors.push(`ID-card photo ${i + 1} is not a valid JPG, PNG or WebP image.`); continue; }
    valid.push({ ...file, type });
    total += file.buffer.length;
  }
  if (total > 4 * 1024 * 1024) errors.push("Both ID-card photos together must be 4 MB or smaller.");
  return { errors, valid };
}
function recoveryText(value, max = 160) { return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max); }
function getBoard() {
  const all = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(publicItem);
  const lost = all.filter(item => item.kind === "lost");
  const found = all.filter(item => item.kind === "found");
  const matches = findMatches(lost, found);
  return { items: all, lost, found, matches, stats: { lost: lost.length, found: found.length, total: all.length, matchCount: matches.length }, weights: { ...BASE_WEIGHTS }, minPercent: MIN_PERCENT };
}
async function storeUploadedPhoto(folder, itemId, file, index) {
  const filename = `${itemId}-${index + 1}-${randomUUID()}${file.type.ext}`;
  if (IS_VERCEL) return storePrivatePhoto(folder, filename, file.buffer, file.type.mimeType);
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer, { flag: "wx" });
  return filename;
}
async function deletePhotoReferences(references) {
  if (IS_VERCEL) {
    await Promise.all((references || []).filter(ref => ref && typeof ref === "object" && ref.pathname).map(ref => deletePrivatePhoto(ref.pathname).catch(() => {})));
    return;
  }
  for (const filename of references || []) {
    if (typeof filename !== "string") continue;
    try { fs.unlinkSync(path.join(UPLOAD_DIR, filename)); } catch {}
  }
}
async function analyzeItem(item, pictures = null) {
  let images = pictures;
  if (!images) {
    images = [];
    for (const file of item.imageFiles || []) {
      if (IS_VERCEL && file && typeof file === "object") {
        const stored = await readPrivatePhoto(file.pathname);
        if (!stored) throw new Error("A stored photo could not be loaded from Vercel Blob.");
        images.push({ buffer: stored.buffer, mimeType: file.contentType || stored.contentType });
      } else {
        const buffer = fs.readFileSync(path.join(UPLOAD_DIR, file));
        const type = detectType(buffer);
        if (!type) throw new Error("A stored image is invalid.");
        images.push({ buffer, mimeType: type.mimeType });
      }
    }
  }
  if (!images.length) { item.visual_profile = null; item.vision_status = "no_images"; return; }
  try {
    item.visual_profile = await analyzeImagesWithGemini(images);
    item.vision_status = "analyzed";
  } catch (error) {
    item.visual_profile = null;
    item.vision_status = error.code === "GEMINI_NOT_CONFIGURED" ? "needs_setup" : "failed";
    console.warn(`Image recognition for report ${item.id} did not complete (${item.vision_status}).`);
  }
}
function validate(body) {
  const errors = [];
  const kind = String(body.kind || ""), category = String(body.category || "").trim(), location = String(body.location || "").trim();
  const date = String(body.date || "").trim(), description = String(body.description || "").trim(), person = String(body.person || "").trim(), mobile = cleanMobile(body.mobile);
  if (!["lost", "found"].includes(kind)) errors.push("Choose Lost or Found.");
  if (!category || category.length > 100) errors.push("Category must be 1–100 characters.");
  if (!location || location.length > 100) errors.push("Location must be 1–100 characters.");
  if (!validDate(date)) errors.push("Enter a valid date that is not in the future.");
  if (description.length < 3 || description.length > 100) errors.push("Description must be 3–100 characters.");
  if (!person || person.length > 100) errors.push("Name must be 1–100 characters.");
  if (!mobile) errors.push("Enter a valid 10-digit Indian mobile number starting with 6–9.");
  return { errors, values: { kind, category, location, date, description, person, mobile } };
}

// Administrator session: it protects the recovery register, recovered ID photos,
// and destructive delete operations on the public deployment.
const ADMIN_COOKIE = "campusfind_admin";
const SESSION_SECONDS = 8 * 60 * 60;
function adminModeEnabled() { return IS_VERCEL || Boolean(process.env.CAMPUSFIND_ADMIN_PASSWORD?.trim()); }
function adminConfigReady() { return Boolean(process.env.CAMPUSFIND_ADMIN_PASSWORD?.trim() && process.env.CAMPUSFIND_SESSION_SECRET?.trim()); }
function sessionSignature(expires) { return createHmac("sha256", process.env.CAMPUSFIND_SESSION_SECRET || "local-dev-only").update(String(expires)).digest("hex"); }
function cookieValue(req, name) {
  const prefix = `${name}=`;
  const cookies = String(req.headers.cookie || "").split(";");
  const cookie = cookies.map(value => value.trim()).find(value => value.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}
function hasAdminSession(req) {
  if (!adminModeEnabled()) return true;
  if (!adminConfigReady()) return false;
  const parts = cookieValue(req, ADMIN_COOKIE).split(".");
  if (parts.length !== 2) return false;
  const expires = Number(parts[0]);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sessionSignature(expires));
  const supplied = Buffer.from(parts[1]);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function requireAdmin(req, res, next) {
  if (!adminModeEnabled()) return next();
  if (!adminConfigReady()) return res.status(503).json({ error: "Set CAMPUSFIND_ADMIN_PASSWORD and CAMPUSFIND_SESSION_SECRET in Vercel Environment Variables before using administrator-only features." });
  if (!hasAdminSession(req)) return res.status(401).json({ error: "Administrator sign-in required.", adminRequired: true });
  return next();
}
function sendPrivateImage(res, file) {
  res.setHeader("Content-Type", file.contentType || "application/octet-stream");
  res.setHeader("Content-Length", file.buffer.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  return res.end(file.buffer);
}

app.get("/api/health", (_req, res) => res.json({ ok: true, cloud: IS_VERCEL, aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()), adminConfigured: adminConfigReady() }));
app.get("/api/admin/session", (req, res) => res.json({ required: adminModeEnabled(), authenticated: hasAdminSession(req), configured: adminConfigReady() }));
app.post("/api/admin/login", (req, res) => {
  if (!adminModeEnabled()) return res.json({ ok: true, authenticated: true });
  if (!adminConfigReady()) return res.status(503).json({ error: "Administrator login is not configured. Set CAMPUSFIND_ADMIN_PASSWORD and CAMPUSFIND_SESSION_SECRET." });
  const supplied = createHash("sha256").update(String(req.body?.password ?? "")).digest();
  const expected = createHash("sha256").update(String(process.env.CAMPUSFIND_ADMIN_PASSWORD)).digest();
  if (!timingSafeEqual(supplied, expected)) return res.status(401).json({ error: "Incorrect administrator password." });
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = `${expires}.${sessionSignature(expires)}`;
  const secure = IS_VERCEL ? "Secure; " : "";
  res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${secure}SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`);
  return res.json({ ok: true, authenticated: true, expiresAt: new Date(expires * 1000).toISOString() });
});

app.get("/api/item-photo", async (req, res, next) => {
  if (!IS_VERCEL) return res.status(404).json({ error: "Not found." });
  const pathname = String(req.query.pathname || "");
  if (!pathname.startsWith("items/")) return res.status(404).json({ error: "Photo not found." });
  try {
    const photo = await readPrivatePhoto(pathname);
    if (!photo) return res.status(404).json({ error: "Photo not found." });
    return sendPrivateImage(res, photo);
  } catch (error) { return next(error); }
});

app.use("/api/items", refreshCloudState);
app.use("/api/recovered-items", requireAdmin, refreshCloudState);

app.get("/api/items", (_req, res) => res.json(getBoard()));
app.post("/api/items", upload.array("photos", 3), async (req, res, next) => {
  let item;
  try {
    const { errors, values } = validate(req.body || {}), uploaded = req.files || [];
    if (values.kind === "found" && !uploaded.length) errors.push("A found-item report must include at least one photo.");
    const valid = [];
    let total = 0;
    for (let i = 0; i < uploaded.length; i++) {
      const file = uploaded[i], type = detectType(file.buffer);
      if (!type || type.mimeType !== file.mimetype) { errors.push(`Photo ${i + 1} is not a valid JPG, PNG or WebP image.`); continue; }
      valid.push({ ...file, type });
      total += file.buffer.length;
    }
    if (total > (IS_VERCEL ? 4 * 1024 * 1024 : 5 * 1024 * 1024)) errors.push("All photos together must be 4 MB or smaller for cloud uploads.");
    if (errors.length) return res.status(400).json({ error: "Please check the form.", details: errors });
    item = { id: randomUUID(), ...values, createdAt: new Date().toISOString(), imageFiles: [], visual_profile: null, vision_status: valid.length ? "pending" : "no_images" };
    const pictures = [];
    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        item.imageFiles.push(await storeUploadedPhoto("items", item.id, file, i));
        pictures.push({ buffer: file.buffer, mimeType: file.type.mimeType });
      }
      items.push(item);
      await persistItem(item);
    } catch (error) {
      items = items.filter(candidate => candidate.id !== item.id);
      await deletePhotoReferences(item.imageFiles);
      throw error;
    }
    await analyzeItem(item, pictures);
    await persistItem(item);
    const board = getBoard(), created = board.items.find(candidate => candidate.id === item.id);
    const matches = board.matches.filter(match => match.lost.id === item.id || match.found.id === item.id);
    return res.status(201).json({ item: created, matches, stats: board.stats, vision_status: item.vision_status, aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()) });
  } catch (error) { return next(error); }
});
app.post("/api/items/:id/analyze", async (req, res, next) => {
  try {
    const item = items.find(candidate => candidate.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Report not found." });
    if (!(item.imageFiles || []).length) return res.status(400).json({ error: "This report has no photos to analyze." });
    await analyzeItem(item);
    await persistItem(item);
    const board = getBoard(), version = board.items.find(candidate => candidate.id === item.id);
    const matches = board.matches.filter(match => match.lost.id === item.id || match.found.id === item.id);
    if (item.vision_status === "needs_setup") return res.status(412).json({ error: "Add GEMINI_API_KEY to Vercel Environment Variables (cloud) or .env (local), then retry.", item: version });
    if (item.vision_status !== "analyzed") return res.status(502).json({ error: "Gemini image recognition is temporarily unavailable. The report remains saved; try again later.", item: version });
    return res.json({ item: version, matches, vision_status: item.vision_status });
  } catch (error) { return next(error); }
});

app.get("/api/recovered-items", (_req, res) => {
  const records = [...recoveryRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(publicRecoveryRecord);
  const recoveredItemIds = new Set(recoveryRecords.map(record => String(record.itemId || "")).filter(Boolean));
  const foundItems = [...items].filter(item => item.kind === "found").sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => ({
    id: item.id, category: item.category, location: item.location, date: item.date, description: item.description,
    alreadyRecovered: recoveredItemIds.has(String(item.id))
  }));
  res.json({ records, total: records.length, foundItems });
});
app.get("/api/recovered-items/photo", async (req, res, next) => {
  const pathname = String(req.query.pathname || "");
  if (!pathname.startsWith("recovered/")) return res.status(404).json({ error: "Photo not found." });
  try {
    const photo = await readPrivatePhoto(pathname);
    if (!photo) return res.status(404).json({ error: "Photo not found." });
    return sendPrivateImage(res, photo);
  } catch (error) { return next(error); }
});
app.post("/api/recovered-items/analyze-id", recoveryUpload.array("idPhotos", 2), async (req, res, next) => {
  try {
    const files = req.files || [], { errors, valid } = validateIdPhotos(files);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const photos = valid.map(file => ({ buffer: file.buffer, mimeType: file.type.mimeType }));
    try {
      const student = await extractStudentDetailsWithGemini(photos);
      return res.json({ student });
    } catch (error) {
      if (error.code === "GEMINI_NOT_CONFIGURED") return res.status(412).json({ error: "Gemini is not configured. Add GEMINI_API_KEY in Vercel Environment Variables or .env, or enter the student details manually." });
      console.warn("Student ID extraction did not complete:", error.message);
      return res.status(502).json({ error: "Gemini could not read these ID-card images right now. Try clearer front/back photos or enter the details manually." });
    }
  } catch (error) { return next(error); }
});
app.post("/api/recovered-items", recoveryUpload.array("idPhotos", 2), async (req, res, next) => {
  let record;
  try {
    const body = req.body || {}, files = req.files || [], { errors, valid } = validateIdPhotos(files);
    const itemId = recoveryText(body.itemId, 80), receivedAt = String(body.receivedAt || "").trim();
    const studentName = recoveryText(body.studentName, 120), rollNumber = recoveryText(body.rollNumber, 80);
    const course = recoveryText(body.course, 120), notes = recoveryText(body.notes, 500);
    const foundItem = items.find(item => item.id === itemId && item.kind === "found");
    if (!itemId) errors.push("Select the found-item report being handed over.");
    else if (!foundItem) errors.push("The selected found-item report could not be found. Refresh the page and choose again.");
    if (!validDate(receivedAt)) errors.push("Enter a valid recovery date that is not in the future.");
    if (!studentName) errors.push("Student name is required.");
    if (!rollNumber) errors.push("Student roll number is required.");
    if (!course) errors.push("Student course is required.");
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    if (recoveryRecords.some(existing => String(existing.itemId || "") === String(foundItem.id))) return res.status(409).json({ error: "This found-item report is already recorded as recovered." });
    record = {
      id: randomUUID(), itemId: foundItem.id, itemName: `${foundItem.category} · ${foundItem.location}`,
      itemDescription: foundItem.description || "", notes, receivedAt, studentName, rollNumber, course,
      createdAt: new Date().toISOString(), idPhotoFiles: []
    };
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      record.idPhotoFiles.push(await storeUploadedPhoto("recovered", record.id, file, i));
    }
    try {
      if (IS_VERCEL) {
        await persistRecovery(record);
        recoveryRecords.push(record);
      } else {
        recoveryRecords.push(record);
        saveRecoveryRecords();
      }
    } catch (error) {
      recoveryRecords = recoveryRecords.filter(existing => existing.id !== record.id);
      await deletePhotoReferences(record.idPhotoFiles);
      if (error?.code === "23505") return res.status(409).json({ error: "This found-item report is already recorded as recovered." });
      throw error;
    }
    return res.status(201).json({ record: publicRecoveryRecord(record), total: recoveryRecords.length });
  } catch (error) {
    if (record?.idPhotoFiles?.length && !recoveryRecords.some(existing => existing.id === record.id)) await deletePhotoReferences(record.idPhotoFiles);
    return next(error);
  }
});
app.delete("/api/recovered-items/:id", async (req, res, next) => {
  try {
    const record = recoveryRecords.find(existing => existing.id === req.params.id);
    if (!record) return res.status(404).json({ error: "Recovered-item record not found." });
    await deletePhotoReferences(record.idPhotoFiles || []);
    recoveryRecords = recoveryRecords.filter(existing => existing.id !== req.params.id);
    if (IS_VERCEL) await deleteCloudRecovery(req.params.id); else saveRecoveryRecords();
    return res.json({ deleted: 1, id: req.params.id, total: recoveryRecords.length });
  } catch (error) { return next(error); }
});
app.delete("/api/items/clear", requireAdmin, async (_req, res, next) => {
  try {
    const count = items.length;
    for (const item of items) await deletePhotoReferences(item.imageFiles || []);
    if (IS_VERCEL) await clearCloudItems();
    else { items = []; saveItems(); }
    items = [];
    return res.json({ deleted: count });
  } catch (error) { return next(error); }
});
app.delete("/api/items/:id", requireAdmin, async (req, res, next) => {
  try {
    const item = items.find(candidate => candidate.id === req.params.id);
    if (!item) return res.status(404).json({ error: "Report not found." });
    await deletePhotoReferences(item.imageFiles || []);
    items = items.filter(candidate => candidate.id !== req.params.id);
    if (IS_VERCEL) await deleteCloudItem(req.params.id); else saveItems();
    return res.json({ deleted: 1, id: req.params.id });
  } catch (error) { return next(error); }
});

if (!IS_VERCEL) app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "Each photo must be 2 MB or smaller." : error.code === "LIMIT_FILE_COUNT" ? (req.path.startsWith("/api/recovered-items") ? "Upload exactly two ID-card photos, front and back." : "Upload no more than 3 photos.") : "The uploaded photos could not be processed.";
    return res.status(400).json({ error: message });
  }
  console.error("Request failed:", error?.message || "unknown error");
  const status = error.status || (error.code === "CAMPUSFIND_DATABASE_NOT_CONFIGURED" || error.code === "CAMPUSFIND_BLOB_NOT_CONFIGURED" ? 503 : 500);
  return res.status(status).json({ error: error.message || "Unexpected server error." });
});

if (!IS_VERCEL) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`CampusFind is running at http://localhost:${PORT}`);
    console.log(`Gemini image recognition: ${process.env.GEMINI_API_KEY?.trim() ? "configured" : "not configured (text matching still works)"}`);
  });
}

export default app;
