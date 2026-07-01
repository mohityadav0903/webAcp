import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WORKSPACE_UPLOADS_DIR } from '@webacp/protocol';

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^\w.\-()+@ ]+/g, '_').trim();
  return cleaned || 'upload';
}

export async function materializeUpload(options: {
  cwd: string;
  name: string;
  mimeType: string;
  data: Buffer;
  threadId?: string | null;
}): Promise<{ path: string }> {
  const subdir = options.threadId?.trim() || 'draft';
  const dir = join(options.cwd, WORKSPACE_UPLOADS_DIR, subdir);
  await mkdir(dir, { recursive: true });

  const safeName = sanitizeFilename(options.name);
  let dest = join(dir, safeName);
  let relativePath = `${WORKSPACE_UPLOADS_DIR}/${subdir}/${safeName}`;
  let attempt = 1;
  while (attempt < 100) {
    try {
      await writeFile(dest, options.data, { flag: 'wx' });
      return { path: relativePath };
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
      if (code !== 'EEXIST') throw err;
      const dot = safeName.lastIndexOf('.');
      const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
      const ext = dot > 0 ? safeName.slice(dot) : '';
      dest = join(dir, `${stem}-${attempt + 1}${ext}`);
      relativePath = `${WORKSPACE_UPLOADS_DIR}/${subdir}/${stem}-${attempt + 1}${ext}`;
      attempt++;
    }
  }
  throw new Error('Could not allocate unique upload path');
}
