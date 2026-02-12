import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AttachmentLike } from './image-download.js';

// Keep in sync with image-download.ts
const ALLOWED_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

/** Max bytes per individual text file (100 KB). Files exceeding this are truncated. */
const MAX_FILE_BYTES = 100 * 1024;

/** Max total bytes across all text files in one message (200 KB). */
const MAX_TOTAL_BYTES = 200 * 1024;

/** Per-file download timeout (10 seconds). */
const DOWNLOAD_TIMEOUT_MS = 10_000;

/** MIME types that are treated as text (checked via startsWith for text/*). */
const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/toml',
  'application/sql',
  'application/graphql',
  'application/x-httpd-php',
  'application/x-sh',
  'application/x-yaml',
]);

/** Extension-to-MIME fallback map for text types. */
const EXT_TO_TEXT_MIME: Record<string, string> = {
  // --- Existing ---
  txt: 'text/plain',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
  js: 'application/javascript',
  ts: 'application/typescript',
  xml: 'application/xml',
  html: 'text/html',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  py: 'text/x-script',
  rb: 'text/x-script',
  sh: 'text/x-script',
  bash: 'text/x-script',
  zsh: 'text/x-script',

  // --- Web / frontend ---
  jsx: 'application/javascript',
  tsx: 'application/typescript',
  mjs: 'application/javascript',
  cjs: 'application/javascript',
  mts: 'application/typescript',
  cts: 'application/typescript',
  css: 'text/css',
  scss: 'text/css',
  sass: 'text/css',
  less: 'text/css',
  vue: 'text/html',
  svelte: 'text/html',
  astro: 'text/html',
  htm: 'text/html',

  // --- Template engines ---
  njk: 'text/html',
  ejs: 'text/html',
  hbs: 'text/html',
  pug: 'text/html',

  // --- Systems / compiled (source is text) ---
  c: 'text/x-script',
  h: 'text/x-script',
  cpp: 'text/x-script',
  cxx: 'text/x-script',
  cc: 'text/x-script',
  hpp: 'text/x-script',
  hxx: 'text/x-script',
  cs: 'text/x-script',
  java: 'text/x-script',
  kt: 'text/x-script',
  kts: 'text/x-script',
  scala: 'text/x-script',
  go: 'text/x-script',
  rs: 'text/x-script',
  swift: 'text/x-script',
  m: 'text/x-script',
  mm: 'text/x-script',
  zig: 'text/x-script',
  nim: 'text/x-script',
  v: 'text/x-script',
  d: 'text/x-script',

  // --- Scripting / dynamic ---
  php: 'text/x-script',
  pl: 'text/x-script',
  pm: 'text/x-script',
  r: 'text/x-script',
  lua: 'text/x-script',
  tcl: 'text/x-script',
  ex: 'text/x-script',
  exs: 'text/x-script',
  erl: 'text/x-script',
  hrl: 'text/x-script',
  clj: 'text/x-script',
  cljs: 'text/x-script',
  cljc: 'text/x-script',
  hs: 'text/x-script',
  ml: 'text/x-script',
  mli: 'text/x-script',
  fs: 'text/x-script',
  fsx: 'text/x-script',
  jl: 'text/x-script',
  dart: 'text/x-script',
  groovy: 'text/x-script',
  gradle: 'text/x-script',
  ps1: 'text/x-script',
  psm1: 'text/x-script',
  fish: 'text/x-script',
  nix: 'text/x-script',
  gd: 'text/x-script',

  // --- Config / data ---
  toml: 'application/toml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  env: 'text/plain',
  properties: 'text/plain',
  json5: 'application/json',
  jsonc: 'application/json',
  editorconfig: 'text/plain',
  gitignore: 'text/plain',
  gitattributes: 'text/plain',
  dockerignore: 'text/plain',
  npmrc: 'text/plain',
  nvmrc: 'text/plain',
  prettierrc: 'text/plain',
  eslintrc: 'text/plain',
  babelrc: 'text/plain',

  // --- Infrastructure / IaC ---
  tf: 'text/plain',
  tfvars: 'text/plain',
  hcl: 'text/plain',

  // --- Data / query / IDL ---
  sql: 'application/sql',
  graphql: 'application/graphql',
  gql: 'application/graphql',
  proto: 'text/plain',
  prisma: 'text/plain',

  // --- Markup / docs ---
  rst: 'text/plain',
  tex: 'text/plain',
  latex: 'text/plain',
  adoc: 'text/plain',
  org: 'text/plain',
  wiki: 'text/plain',
  rdoc: 'text/plain',

  // --- Build / CI ---
  // Note: bare Dockerfile/Makefile/Gemfile (no extension) won't match via
  // extension extraction — lastIndexOf('.') returns -1 for extensionless filenames.
  // These entries only cover the foo.dockerfile / foo.makefile variant.
  dockerfile: 'text/plain',
  makefile: 'text/plain',
  cmake: 'text/plain',
  rake: 'text/x-script',
  gemfile: 'text/x-script',

  // --- Shell / terminal ---
  ksh: 'text/x-script',
  csh: 'text/x-script',
  tcsh: 'text/x-script',
  bat: 'text/x-script',
  cmd: 'text/x-script',
  awk: 'text/x-script',

  // --- Misc text ---
  log: 'text/plain',
  diff: 'text/plain',
  patch: 'text/plain',
  svg: 'text/xml',
};

export type TextDownloadResult = {
  texts: Array<{ name: string; content: string }>;
  errors: string[];
};

/**
 * Resolve a text MIME type from contentType or file extension.
 * Returns the MIME string if it's a supported text type, null otherwise.
 */
export function resolveTextType(attachment: AttachmentLike): string | null {
  if (attachment.contentType) {
    const mime = attachment.contentType.split(';')[0].trim().toLowerCase();
    if (mime.startsWith('text/')) return mime;
    if (TEXT_APPLICATION_TYPES.has(mime)) return mime;
  }

  const name = attachment.name ?? '';
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = name.slice(dotIdx + 1).toLowerCase();
    const mime = EXT_TO_TEXT_MIME[ext];
    if (mime) return mime;
  }

  return null;
}

/** Check if a MIME type is a supported text type. */
export function isTextType(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_APPLICATION_TYPES.has(mime);
}

/** Sanitize an attachment filename for display. */
function safeName(attachment: AttachmentLike): string {
  const raw = attachment.name ?? 'unknown';
  return raw.replace(/[\x00-\x1f]/g, '').slice(0, 100).trim() || 'unknown';
}

/**
 * Classify attachments into text, unsupported, and image (skipped) buckets.
 * Image attachments are excluded — they're handled by image-download.ts.
 */
export function classifyAttachments(attachments: Iterable<AttachmentLike>): {
  text: Array<{ attachment: AttachmentLike; mime: string }>;
  unsupported: AttachmentLike[];
} {
  const text: Array<{ attachment: AttachmentLike; mime: string }> = [];
  const unsupported: AttachmentLike[] = [];

  for (const att of attachments) {
    const textMime = resolveTextType(att);
    if (textMime) {
      text.push({ attachment: att, mime: textMime });
    } else {
      unsupported.push(att);
    }
  }

  return { text, unsupported };
}

/**
 * Download non-image text attachments from a Discord message.
 *
 * - Filters for text-like MIME types
 * - Truncates files exceeding MAX_FILE_BYTES with a marker
 * - Skips files once MAX_TOTAL_BYTES is reached
 * - Notes unsupported attachment types in errors
 */
export async function downloadTextAttachments(
  attachments: Iterable<AttachmentLike>,
): Promise<TextDownloadResult> {
  const { text: candidates, unsupported } = classifyAttachments(attachments);

  const errors: string[] = [];

  // Note unsupported types
  for (const att of unsupported) {
    const name = safeName(att);
    const mime = att.contentType?.split(';')[0].trim() ?? 'unknown';
    errors.push(`[Unsupported attachment: ${name} (${mime})]`);
  }

  if (candidates.length === 0) return { texts: [], errors };

  const texts: Array<{ name: string; content: string }> = [];
  let totalBytes = 0;

  for (const { attachment, mime } of candidates) {
    const name = safeName(attachment);

    // Total budget check
    if (totalBytes >= MAX_TOTAL_BYTES) {
      errors.push(`${name}: skipped (total size limit exceeded)`);
      continue;
    }

    // SSRF protection
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(attachment.url);
    } catch {
      errors.push(`${name}: invalid URL`);
      continue;
    }

    if (parsedUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      errors.push(`${name}: blocked (non-Discord CDN host)`);
      continue;
    }

    // Pre-check size from Discord metadata for total budget
    const metaSize = attachment.size ?? 0;
    if (metaSize > 0 && totalBytes + metaSize > MAX_TOTAL_BYTES) {
      errors.push(`${name}: skipped (total size limit exceeded)`);
      continue;
    }

    try {
      const response = await fetch(attachment.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });

      if (!response.ok) {
        errors.push(`${name}: HTTP ${response.status}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      totalBytes += buffer.length;

      // Decode as UTF-8
      let content: string;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        content = decoder.decode(buffer);
      } catch {
        errors.push(`${name}: not valid UTF-8 text`);
        continue;
      }

      // Truncate if exceeding per-file limit
      if (buffer.length > MAX_FILE_BYTES) {
        const truncated = content.slice(0, MAX_FILE_BYTES);
        texts.push({ name, content: truncated + '\n[truncated at 100KB]' });
      } else {
        texts.push({ name, content });
      }
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : null;
      if (errObj?.name === 'TimeoutError' || errObj?.name === 'AbortError') {
        errors.push(`${name}: download timed out`);
      } else if (errObj?.name === 'TypeError' && String(errObj.message).includes('redirect')) {
        errors.push(`${name}: blocked (unexpected redirect)`);
      } else {
        errors.push(`${name}: download failed`);
      }
    }
  }

  return { texts, errors };
}

// ── Binary (non-text, non-image) file download to disk ──────────────────

/** Max bytes per binary file (50 MB). */
const MAX_BINARY_FILE_BYTES = 50 * 1024 * 1024;

/** Max total bytes across all binary files in one message (100 MB). */
const MAX_BINARY_TOTAL_BYTES = 100 * 1024 * 1024;

/** Max age for cached attachment files (1 hour). */
const ATTACHMENT_MAX_AGE_MS = 60 * 60 * 1000;

export type BinaryDownloadResult = {
  files: Array<{ name: string; path: string }>;
  errors: string[];
};

/**
 * Sanitize a filename for the filesystem: strip directory traversal,
 * control characters, and keep it to a reasonable length.
 */
function safeFilename(raw: string): string {
  return raw
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[/\\]/g, '_')
    .slice(0, 100)
    .trim() || 'attachment';
}

/**
 * Download binary (non-text, non-image) attachments to a directory on disk.
 *
 * Files are saved as `<uuid>-<safe-filename>` under `destDir` so the AI runtime
 * can access them via the Read tool (e.g. PDFs). The caller should include the
 * file path in the prompt.
 */
export async function downloadBinaryAttachments(
  attachments: AttachmentLike[],
  destDir: string,
): Promise<BinaryDownloadResult> {
  if (attachments.length === 0) return { files: [], errors: [] };

  await fs.mkdir(destDir, { recursive: true });

  const files: Array<{ name: string; path: string }> = [];
  const errors: string[] = [];
  let totalBytes = 0;

  for (const att of attachments) {
    const name = safeName(att);

    // Total budget check.
    if (totalBytes >= MAX_BINARY_TOTAL_BYTES) {
      errors.push(`${name}: skipped (total size limit exceeded)`);
      continue;
    }

    // Pre-check size from Discord metadata.
    const metaSize = att.size ?? 0;
    if (metaSize > MAX_BINARY_FILE_BYTES) {
      const sizeMB = (metaSize / (1024 * 1024)).toFixed(1);
      errors.push(`${name}: too large (${sizeMB} MB, max 50 MB)`);
      continue;
    }
    if (metaSize > 0 && totalBytes + metaSize > MAX_BINARY_TOTAL_BYTES) {
      errors.push(`${name}: skipped (total size limit exceeded)`);
      continue;
    }

    // SSRF protection.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(att.url);
    } catch {
      errors.push(`${name}: invalid URL`);
      continue;
    }

    if (parsedUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      errors.push(`${name}: blocked (non-Discord CDN host)`);
      continue;
    }

    try {
      const response = await fetch(att.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });

      if (!response.ok) {
        errors.push(`${name}: HTTP ${response.status}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length > MAX_BINARY_FILE_BYTES) {
        const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
        errors.push(`${name}: too large (${sizeMB} MB, max 50 MB)`);
        continue;
      }

      totalBytes += buffer.length;

      const destFilename = `${randomUUID().slice(0, 8)}-${safeFilename(att.name ?? 'attachment')}`;
      const destPath = path.join(destDir, destFilename);
      await fs.writeFile(destPath, buffer);

      files.push({ name, path: destPath });
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : null;
      if (errObj?.name === 'TimeoutError' || errObj?.name === 'AbortError') {
        errors.push(`${name}: download timed out`);
      } else if (errObj?.name === 'TypeError' && String(errObj.message).includes('redirect')) {
        errors.push(`${name}: blocked (unexpected redirect)`);
      } else {
        errors.push(`${name}: download failed`);
      }
    }
  }

  return { files, errors };
}

/**
 * Remove attachment files older than maxAgeMs from a directory.
 * Best-effort: errors are silently ignored.
 */
export async function cleanupOldAttachments(dir: string, maxAgeMs: number = ATTACHMENT_MAX_AGE_MS): Promise<number> {
  let cleaned = 0;
  try {
    const entries = await fs.readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      try {
        const filePath = path.join(dir, entry);
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          await fs.unlink(filePath);
          cleaned++;
        }
      } catch {
        // ignore per-file errors
      }
    }
  } catch {
    // directory may not exist yet
  }
  return cleaned;
}
