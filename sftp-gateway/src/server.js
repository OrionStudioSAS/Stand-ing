import 'dotenv/config';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import SftpClient from 'ssh2-sftp-client';

const PORT = Number(process.env.PORT || 8787);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 800);
const TOKEN = process.env.GATEWAY_API_TOKEN;
const ALLOWED_ORIGINS = (process.env.PUBLIC_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const SFTP_CONFIG = {
  host: process.env.SFTP_HOST || 'sftpstanding.synology.me',
  port: Number(process.env.SFTP_PORT || 2200),
  username: process.env.SFTP_USERNAME || 'configurator_upload',
  password: process.env.SFTP_PASSWORD,
};

const SFTP_BASE_DIR = normalizeRemoteDir(process.env.SFTP_BASE_DIR || '/');
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
    res.json({ ok: true, host: SFTP_CONFIG.host, port: SFTP_CONFIG.port });
  } catch (error) {
    res.status(502).json({ ok: false, message: getSafeErrorMessage(error) });
  } finally {
    await closeSftp(sftp);
  }
});

app.post(
  '/uploads/production-file',
  requireGatewayToken,
  upload.single('file'),
  async (req, res, next) => {
    const localFile = req.file;
    if (!localFile) {
      res.status(400).json({ ok: false, message: 'Missing multipart file field named "file".' });
      return;
    }

    const sftp = new SftpClient();
    try {
      const folder = buildSceneFolder(req.body);
      const filename = buildUploadFilename(localFile.originalname);
      const remoteDir = joinRemotePath(SFTP_BASE_DIR, folder);
      const remotePath = joinRemotePath(remoteDir, filename);

      await connectSftp(sftp);
      await sftp.mkdir(remoteDir, true);
      await sftp.fastPut(localFile.path, remotePath);

      res.status(201).json({
        ok: true,
        file: {
          originalName: localFile.originalname,
          size: localFile.size,
          remoteDir,
          remotePath,
        },
      });
    } catch (error) {
      next(error);
    } finally {
      await closeSftp(sftp);
      await fs.rm(localFile.path, { force: true }).catch(() => {});
    }
  },
);

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ ok: false, message: error.message });
    return;
  }

  console.error('[sftp-gateway]', error);
  res.status(500).json({ ok: false, message: getSafeErrorMessage(error) });
});

app.listen(PORT, () => {
  console.log(`Stand-ING SFTP gateway listening on http://0.0.0.0:${PORT}`);
});

function requireGatewayToken(req, res, next) {
  if (!TOKEN) {
    res.status(500).json({ ok: false, message: 'GATEWAY_API_TOKEN is not configured.' });
    return;
  }

  const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const headerToken = req.get('x-gateway-token')?.trim();
  const provided = bearer || headerToken || '';

  if (safeEqual(provided, TOKEN)) {
    next();
    return;
  }

  res.status(401).json({ ok: false, message: 'Unauthorized.' });
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
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

function buildSceneFolder(body = {}) {
  const salon = sanitizeSegment(body.salon || body.eventName || 'stand-ing');
  const company = sanitizeSegment(body.company || body.clientName || 'client');
  const stand = sanitizeSegment(body.standNumber || body.sceneName || body.sceneId || 'scene');
  const category = sanitizeSegment(body.category || 'production');
  return `${salon}/${company}/${stand}/${category}`;
}

function buildUploadFilename(originalName = 'fichier') {
  const parsed = path.parse(originalName);
  const base = sanitizeSegment(parsed.name || 'fichier');
  const ext = sanitizeExtension(parsed.ext);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${base}${ext}`;
}

function sanitizeSegment(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .toLowerCase() || 'sans-nom';
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
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/\.\.?\//g, '/');
}

function getSafeErrorMessage(error) {
  if (!error) return 'Unknown error.';
  if (error.code === 'ENOTFOUND') return 'SFTP host not found.';
  if (error.code === 'ECONNREFUSED') return 'SFTP connection refused.';
  if (error.code === 'ETIMEDOUT') return 'SFTP connection timed out.';
  if (error.message) return error.message;
  return 'Unexpected gateway error.';
}
