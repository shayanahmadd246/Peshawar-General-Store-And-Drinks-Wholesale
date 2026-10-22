import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads/voice');

export async function ensureVoiceUploadDir(): Promise<string> {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  return UPLOAD_ROOT;
}

export function checksumBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function saveVoiceBuffer(input: {
  clientId: string;
  assetId: string;
  extension: string;
  buffer: Buffer;
}): Promise<{ absolutePath: string; relativePath: string }> {
  const root = await ensureVoiceUploadDir();
  const safeClient = input.clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const clientDir = path.join(root, safeClient);
  await fs.mkdir(clientDir, { recursive: true });
  const filename = `${input.assetId}.${input.extension.replace(/^\./, '')}`;
  const absolutePath = path.join(clientDir, filename);
  await fs.writeFile(absolutePath, input.buffer);
  const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
  return { absolutePath, relativePath };
}

export async function readVoiceRelative(relativePath: string): Promise<Buffer> {
  const root = await ensureVoiceUploadDir();
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(root)) {
    throw new Error('Invalid audio path.');
  }
  return fs.readFile(absolute);
}

export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav') || m.includes('wave')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('flac')) return 'flac';
  return 'bin';
}
