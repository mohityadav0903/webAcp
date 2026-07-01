import type { ContentBlock } from '@webacp/protocol';

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
}

const TEXT_EXT = /\.(txt|md|json|ts|tsx|js|jsx|css|html|csv|xml|yaml|yml|toml)$/i;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function fileToContentBlock(file: File): Promise<ContentBlock> {
  const mimeType = file.type || 'application/octet-stream';
  if (mimeType.startsWith('image/')) {
    return { type: 'image', mimeType, data: await readAsBase64(file), name: file.name };
  }
  if (mimeType.startsWith('text/') || TEXT_EXT.test(file.name)) {
    return {
      type: 'resource',
      name: file.name,
      mimeType: mimeType === 'application/octet-stream' ? 'text/plain' : mimeType,
      text: await file.text(),
    };
  }
  return { type: 'resource', name: file.name, mimeType, data: await readAsBase64(file) };
}

export function createPendingAttachment(file: File): PendingAttachment {
  const id = crypto.randomUUID();
  const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
  return { id, file, previewUrl };
}

export function revokePendingAttachment(att: PendingAttachment): void {
  if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
}
