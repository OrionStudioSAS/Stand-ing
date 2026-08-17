import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import SftpClient from 'ssh2-sftp-client';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT || 8787);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 800);
const TOKEN = process.env.GATEWAY_API_TOKEN;
const ALLOWED_ORIGINS = (process.env.PUBLIC_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseClientOptions = {
  auth: { persistSession: false },
  realtime: { transport: WebSocket },
};
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, supabaseClientOptions)
  : null;

const SFTP_CONFIG = {
  host: process.env.SFTP_HOST || 'sftpstanding.synology.me',
  port: Number(process.env.SFTP_PORT || 2200),
  username: process.env.SFTP_USERNAME || 'configurator_upload',
  password: process.env.SFTP_PASSWORD,
};

const SFTP_BASE_DIR = normalizeRemoteDir(process.env.SFTP_BASE_DIR || '/Stand-ING SFTP');
const upload = multer({
  dest: path.join(os.tmpdir(), 'stand-ing-sftp-uploads'),
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1,
  },
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  }),
);

app.get('/', (_req, res) => {
  res.json({ service: 'Stand-ING SFTP gateway', ok: true });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/sftp/health', requireGatewayToken, async (_req, res) => {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp);
    await sftp.list(SFTP_BASE_DIR);
    res.json({ ok: true, host: SFTP_CONFIG.host, port: SFTP_CONFIG.port, baseDir: SFTP_BASE_DIR });
  } catch (error) {
    res.status(502).json({ ok: false, message: getSafeErrorMessage(error) });
  } finally {
    await closeSftp(sftp);
  }
});

app.post(
  '/uploads/production-file',
  upload.single('file'),
  async (req, res, next) => {
    const localFile = req.file;
    if (!localFile) {
      res.status(400).json({ ok: false, message: 'Missing multipart file field named "file".' });
      return;
    }

    const sftp = new SftpClient();
    try {
      const auth = await authenticateUploadRequest(req);
      const scene = await loadSceneForUpload(req.body, auth);
      assertCanUploadToScene(auth, scene);

      const surfaceKey = sanitizeKey(req.body.surfaceKey || req.body.itemId || req.body.itemType || 'visual');
      const version = await nextUploadVersion(scene.id, surfaceKey, auth);
      const remoteDir = joinRemotePath(SFTP_BASE_DIR, buildSceneFolder(req.body, scene));
      const remotePath = joinRemotePath(remoteDir, buildUploadFilename(localFile.originalname, req.body, version));

      await connectSftp(sftp);
      await sftp.mkdir(remoteDir, true);
      await sftp.fastPut(localFile.path, remotePath);

      const dbRecord = await registerSceneUploadedFile({
        scene,
        auth,
        body: req.body,
        file: localFile,
        surfaceKey,
        version,
        remoteDir,
        remotePath,
      });

      res.status(201).json({
        ok: true,
        file: {
          id: dbRecord?.id || null,
          originalName: localFile.originalname,
          size: localFile.size,
          version,
          remoteDir,
          remotePath,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      await closeSftp(sftp);
      if (localFile?.path) await fs.rm(localFile.path, { force: true }).catch(() => {});
    }
  },
);

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ ok: false, message: error.message });
    return;
  }

  const status = Number(error?.status || 500);
  if (status >= 500) console.error('[sftp-gateway]', error);
  res.status(status).json({ ok: false, message: getSafeErrorMessage(error) });
});

app.listen(PORT, () => {
  console.log(`Stand-ING SFTP gateway listening on http://0.0.0.0:${PORT}`);
});

function requireGatewayToken(req, res, next) {
  if (!TOKEN) {
    res.status(500).json({ ok: false, message: 'GATEWAY_API_TOKEN is not configured.' });
    return;
  }

  const provided = gatewayTokenFromRequest(req);
  if (safeEqual(provided, TOKEN)) {
    next();
    return;
  }

  res.status(401).json({ ok: false, message: 'Unauthorized.' });
}

async function authenticateUploadRequest(req) {
  const gatewayToken = gatewayTokenFromRequest(req);
  if (TOKEN && safeEqual(gatewayToken, TOKEN)) return { mode: 'gateway-token', admin: true, user: null };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw httpError(500, 'Supabase is not configured on the gateway.');
  }

  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) throw httpError(401, 'Unauthorized.');

  const supabaseUserClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...supabaseClientOptions,
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data, error } = await supabaseUserClient.auth.getUser(bearer);
  if (error || !data?.user) throw httpError(401, 'Session Supabase invalide.');

  const { data: profile } = await supabaseUserClient
    .from('user_profiles')
    .select('role')
    .or(`auth_user_id.eq.${data.user.id},email.eq.${data.user.email}`)
    .maybeSingle();

  return { mode: 'supabase-user', user: data.user, admin: profile?.role === 'admin', db: supabaseUserClient };
}

function gatewayTokenFromRequest(req) {
  return req.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || req.get('x-gateway-token')?.trim() || '';
}

async function loadSceneForUpload(body = {}, auth = {}) {
  const db = auth.db || supabaseAdmin;
  if (!db) throw httpError(500, 'Supabase database client is not configured on the gateway.');
  const sceneId = String(body.sceneId || '').trim();
  const sceneToken = String(body.sceneToken || '').trim();
  if (!sceneId && !sceneToken) throw httpError(400, 'Scene id or token is required.');

  let query = db
    .from('scenes')
    .select('id, share_token, salon, offer, client_name, client_email, project_name, event_name, source_payload');
  query = sceneId ? query.eq('id', sceneId) : query.eq('share_token', sceneToken);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, 'Scène introuvable.');
  return data;
}

function assertCanUploadToScene(auth, scene) {
  if (auth.admin) return;
  // The scene was loaded with the user's Supabase session, so RLS already
  // decided whether this exhibitor/admin can access it. Avoid a second
  // email-only check because some scenes are reached by token/admin flows.
  if (auth.mode === 'supabase-user' && auth.db && scene?.id) return;
  const userEmail = String(auth.user?.email || '').trim().toLowerCase();
  const sceneEmail = String(scene.client_email || '').trim().toLowerCase();
  if (userEmail && sceneEmail && userEmail === sceneEmail) return;
  throw httpError(403, 'Accès refusé pour cette scène.');
}

async function nextUploadVersion(sceneId, surfaceKey, auth = {}) {
  const db = auth.db || supabaseAdmin;
  if (!db) return 1;
  const { data, error } = await db
    .from('scene_uploaded_files')
    .select('version')
    .eq('scene_id', sceneId)
    .eq('surface_key', surfaceKey)
    .order('version', { ascending: false })
    .limit(1);
  if (error) throw error;
  return Number(data?.[0]?.version || 0) + 1;
}

async function registerSceneUploadedFile({ scene, auth, body, file, surfaceKey, version, remoteDir, remotePath }) {
  const db = auth.db || supabaseAdmin;
  if (!db) return null;
  await db
    .from('scene_uploaded_files')
    .update({ is_active: false })
    .eq('scene_id', scene.id)
    .eq('surface_key', surfaceKey)
    .eq('is_active', true);

  const { data, error } = await db
    .from('scene_uploaded_files')
    .insert({
      scene_id: scene.id,
      item_uid: body.itemId || null,
      item_type: body.itemType || null,
      surface_key: surfaceKey,
      surface_label: body.surfaceLabel || body.itemLabel || body.itemType || null,
      original_filename: file.originalname,
      original_mime_type: body.originalMimeType || file.mimetype || null,
      original_size: Number(body.originalSize || file.size || 0),
      preview_url: body.previewUrl || null,
      preview_storage_path: body.previewStoragePath || null,
      sftp_remote_dir: remoteDir,
      sftp_remote_path: remotePath,
      version,
      is_active: true,
      uploaded_by: auth.user?.id || null,
      metadata: {
        salon: body.salon || scene.salon || '',
        offer: body.offer || scene.offer || '',
        company: body.company || scene.client_name || '',
        hall: body.hall || '',
        aisle: body.aisle || '',
        standNumber: body.standNumber || '',
      },
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

async function connectSftp(sftp) {
  if (!SFTP_CONFIG.password) {
    throw new Error('SFTP_PASSWORD is not configured.');
  }
  await sftp.connect(SFTP_CONFIG);
}

async function closeSftp(sftp) {
  try {
    await sftp.end();
  } catch (_error) {
    // Ignore close errors: the request result has already been decided.
  }
}

function buildSceneFolder(body = {}, scene = {}) {
  const salon = salonFolderName(body.salon || scene.salon || scene.event_name || 'SMCL');
  const pack = packFolderName(body.offer || scene.offer || scene.source_payload?.offer || scene.source_payload?.pack || 'CONFORT');
  const exhibitor = exhibitorFolderName(body, scene);
  return joinRemotePath(salon, '00_STAND PACK', pack, exhibitor, '00_SIGNA');
}

function exhibitorFolderName(body = {}, scene = {}) {
  const source = scene.source_payload || {};
  const company = folderSegment(body.company || scene.client_name || source.name || source.item?.name || source.client_name || 'EXPOSANT');
  const hall = shortCode(body.hall || source.hall || '');
  const aisle = shortCode(body.aisle || source.aisle_number || source.allee || '');
  const stand = shortCode(body.standNumber || source.stand_number || '');
  const location = `${hall}${standCode(aisle, stand)}`.trim();
  return folderSegment([company, location].filter(Boolean).join(' '));
}

function standCode(aisle = '', stand = '') {
  if (aisle && stand && normalizeForCompare(stand).startsWith(normalizeForCompare(aisle))) return stand;
  return `${aisle}${stand}`;
}

function salonFolderName(value = '') {
  const text = normalizeForCompare(value);
  if (text.includes('smcl')) return 'SMCL';
  if (text.includes('siae')) return 'SIAE';
  return folderSegment(String(value || 'SALON').replace(/\b20\d{2}\b/g, '').trim());
}

function packFolderName(value = '') {
  const text = normalizeForCompare(value);
  if (text.includes('prestige')) return 'PRESTIGE';
  if (text.includes('confort')) return 'CONFORT';
  if (text.includes('business')) return 'BUSINESS';
  if (text.includes('siae')) return 'SIAE';
  return folderSegment(value || 'PACK');
}

function buildUploadFilename(originalName = 'fichier', body = {}, version = 1) {
  const parsed = path.parse(originalName);
  const target = filenameSegment(body.surfaceLabel || body.itemLabel || body.itemType || 'visuel');
  const base = filenameSegment(parsed.name || 'fichier');
  const ext = sanitizeExtension(parsed.ext);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${stamp}_${target}_v${version}_${base}${ext}`;
}

function folderSegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90)
    .toUpperCase() || 'SANS NOM';
}

function filenameSegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .toLowerCase() || 'sans-nom';
}

function sanitizeKey(value = '') {
  return filenameSegment(value).slice(0, 120) || 'visual';
}

function shortCode(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function normalizeForCompare(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function sanitizeExtension(value) {
  const clean = String(value || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return clean.startsWith('.') ? clean.slice(0, 16) : '';
}

function normalizeRemoteDir(value) {
  const clean = String(value || '/').trim().replace(/\\/g, '/');
  return clean.startsWith('/') ? clean.replace(/\/+$/g, '') || '/' : `/${clean.replace(/\/+$/g, '')}`;
}

function joinRemotePath(...parts) {
  const joined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function getSafeErrorMessage(error) {
  if (!error) return 'Unknown error.';
  if (error.status && error.message) return error.message;
  if (error.code === 'ENOTFOUND') return 'SFTP host not found.';
  if (error.code === 'ECONNREFUSED') return 'SFTP connection refused.';
  if (error.code === 'ETIMEDOUT') return 'SFTP connection timed out.';
  if (/permission denied/i.test(error.message || '')) return 'SFTP permission denied.';
  return error.message || 'Unexpected gateway error.';
}
