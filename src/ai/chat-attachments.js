/**
 * Chat / job file attachments.
 *
 * Text files are inlined into the prompt. Images are written to a temp path and
 * passed to QVAC as multimodal `attachments: [{ path }]` (llama.cpp media type).
 * Cap is 1 MB per file — matches the product requirement for chat + jobs API.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export const MAX_ATTACHMENT_BYTES = 1 * 1024 * 1024; // 1 MB
export const MAX_ATTACHMENTS = 4;
export const MAX_TEXT_INLINE_CHARS = 200_000; // after decode, ~1 MB of text is plenty

const TEXT_MIME = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css', 'text/xml',
  'application/json', 'application/xml', 'application/javascript', 'application/x-javascript',
  'application/yaml', 'application/x-yaml', 'application/toml',
]);

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.log', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.html', '.htm', '.css', '.yaml', '.yml', '.xml', '.sh', '.bash', '.zsh',
  '.env', '.toml', '.ini', '.cfg', '.conf', '.sql', '.rs', '.go', '.java', '.c',
  '.cpp', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.r', '.R',
]);

const IMAGE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp',
]);

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function extOf(name = '') {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function classifyAttachment(name, mime) {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const ext = extOf(name);
  if (IMAGE_MIME.has(m) || IMAGE_EXT.has(ext)) return 'image';
  if (TEXT_MIME.has(m) || TEXT_EXT.has(ext) || m.startsWith('text/')) return 'text';
  // Unknown mime with no extension → treat as binary text attempt only if small text-like
  if (!m || m === 'application/octet-stream') {
    if (TEXT_EXT.has(ext)) return 'text';
    if (IMAGE_EXT.has(ext)) return 'image';
  }
  return 'unsupported';
}

/** Directory for staged attachment files (images need real paths for QVAC). */
export function attachmentsDir() {
  const dir = path.join(os.homedir(), '.poh-miner', 'chat-attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Normalize one client attachment into a server-side form.
 *
 * Accepted shapes:
 *   { name, content }                    — plain text (legacy)
 *   { name, mime?, text }                — plain text
 *   { name, mime?, contentBase64 }       — binary (image or text-as-bytes)
 *   { name, mime?, dataUrl }             — data:<mime>;base64,...
 *
 * Returns { kind, name, mime, text?, path?, bytes } or throws.
 */
export function materializeAttachment(raw, { maxBytes = MAX_ATTACHMENT_BYTES } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid attachment');
  const name = String(raw.name || 'file').replace(/[^\w.\- ()[\]]+/g, '_').slice(0, 180) || 'file';
  let mime = raw.mime || raw.type || '';
  let buf = null;
  let text = null;

  if (typeof raw.dataUrl === 'string' && raw.dataUrl.startsWith('data:')) {
    const m = raw.dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) throw new Error(`Invalid data URL for "${name}"`);
    mime = mime || m[1] || 'application/octet-stream';
    const payload = m[3] || '';
    buf = m[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  } else if (typeof raw.contentBase64 === 'string') {
    buf = Buffer.from(raw.contentBase64, 'base64');
  } else if (typeof raw.content === 'string' || typeof raw.text === 'string') {
    text = String(raw.content ?? raw.text);
    buf = Buffer.from(text, 'utf8');
  } else if (Buffer.isBuffer(raw.buffer)) {
    buf = raw.buffer;
  } else {
    throw new Error(`Attachment "${name}" has no content`);
  }

  if (!buf || buf.length === 0) throw new Error(`Attachment "${name}" is empty`);
  if (buf.length > maxBytes) {
    throw new Error(`Attachment "${name}" is too large (${(buf.length / 1024).toFixed(0)} KB). Max is ${Math.round(maxBytes / 1024)} KB.`);
  }

  const kind = classifyAttachment(name, mime);
  if (kind === 'unsupported') {
    throw new Error(`Unsupported file type for "${name}". Attach text (txt/md/json/csv/code) or images (png/jpg/webp/gif).`);
  }

  if (kind === 'text') {
    if (text == null) text = buf.toString('utf8');
    if (text.length > MAX_TEXT_INLINE_CHARS) text = text.slice(0, MAX_TEXT_INLINE_CHARS);
    return { kind: 'text', name, mime: mime || 'text/plain', text, bytes: buf.length };
  }

  // Image → real file path for QVAC multimodal attachments.
  const id = crypto.randomBytes(8).toString('hex');
  const safeExt = IMAGE_EXT.has(extOf(name)) ? extOf(name) : '.png';
  const filePath = path.join(attachmentsDir(), `${Date.now()}-${id}${safeExt}`);
  fs.writeFileSync(filePath, buf);
  // Best-effort cleanup after 1 hour.
  setTimeout(() => { try { fs.unlinkSync(filePath); } catch { /* */ } }, 60 * 60 * 1000).unref?.();

  return {
    kind: 'image',
    name,
    mime: mime || 'image/png',
    path: filePath,
    bytes: buf.length,
  };
}

/**
 * Materialize a list of client attachments. Returns { files, errors }.
 * Soft-fails individual bad files so one bad attachment doesn't kill the request.
 */
export function materializeAttachments(list, opts = {}) {
  const arr = Array.isArray(list) ? list.slice(0, MAX_ATTACHMENTS) : [];
  const files = [];
  const errors = [];
  for (const raw of arr) {
    try {
      files.push(materializeAttachment(raw, opts));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { files, errors };
}

/**
 * Fold attachments into chat messages for QVAC.
 * - Text → append fenced block to last user message content
 * - Image → set `attachments: [{ path }]` on last user message (multimodal)
 *
 * Returns { messages, hasImages, notes }.
 */
export function applyAttachmentsToMessages(messages, files) {
  const notes = [];
  if (!files?.length) return { messages, hasImages: false, notes };

  const out = (messages || []).map(m => ({ ...m, content: m.content != null ? String(m.content) : '' }));
  // Ensure there is a user message to attach to.
  let userIdx = -1;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].role === 'user') { userIdx = i; break; }
  }
  if (userIdx < 0) {
    out.push({ role: 'user', content: '' });
    userIdx = out.length - 1;
  }

  const textBlocks = [];
  const imagePaths = [];
  for (const f of files) {
    if (f.kind === 'text') {
      textBlocks.push(`[Attached file: ${f.name}]\n\`\`\`\n${f.text}\n\`\`\``);
      notes.push(`text:${f.name}(${f.bytes}B)`);
    } else if (f.kind === 'image') {
      imagePaths.push({ path: f.path });
      notes.push(`image:${f.name}(${f.bytes}B)`);
    }
  }

  if (textBlocks.length) {
    const prefix = out[userIdx].content ? `${out[userIdx].content}\n\n` : '';
    out[userIdx] = { ...out[userIdx], content: prefix + textBlocks.join('\n\n') };
  }
  if (imagePaths.length) {
    const existing = Array.isArray(out[userIdx].attachments) ? out[userIdx].attachments : [];
    out[userIdx] = {
      ...out[userIdx],
      // If the user only attached an image, give the model a minimal prompt.
      content: out[userIdx].content || 'Please describe and analyze the attached image(s).',
      attachments: [...existing, ...imagePaths],
    };
  }

  return { messages: out, hasImages: imagePaths.length > 0, notes };
}

/** Friendly model id for image understanding when the active model is text-only. */
export const DEFAULT_VISION_MODEL = 'qwen3vl-2b';

export function isVisionModelName(name = '') {
  return /vl|vision|multimodal|smolvlm|mmproj/i.test(String(name));
}
