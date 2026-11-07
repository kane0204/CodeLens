import type { SelectedFile } from '../types';

export const SUPPORTED_EXTENSIONS = [
  '.py',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.java',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.go',
] as const;

export const EXCLUDED_DIRS = ['.git', '.venv', 'venv', '__pycache__', 'node_modules', 'build', 'dist', 'tests'];

export const LIMITS = {
  maxFiles: 200,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
};

export const SUPPORTED_LABEL = 'Python / C / C++ / Java / JavaScript / TypeScript / Go';

export interface RawFile {
  file: File;
  path: string;
}

export interface PreparedSelection {
  project: string;
  files: SelectedFile[];
  errors: string[];
  ignored: Record<string, number>;
  totalBytes: number;
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '无扩展名';
}

function isExcluded(path: string): boolean {
  const parts = normalizePath(path).split('/').slice(0, -1);
  return parts.some((part) => EXCLUDED_DIRS.includes(part));
}

function isSupported(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function prepareSelection(raw: RawFile[]): PreparedSelection {
  const { supported, ignored } = filterSourceFiles(raw);
  const totalBytes = supported.reduce((sum, item) => sum + item.file.size, 0);
  const errors = selectionErrors(supported, totalBytes);
  const roots = new Set(supported.map((item) => (item.path.includes('/') ? item.path.split('/')[0] : '')));
  const root = roots.size === 1 ? [...roots][0] : '';
  const project = root || '所选项目';

  const files: SelectedFile[] = supported.map((item) => ({
    file: item.file,
    path: root ? item.path.slice(root.length + 1) : item.path,
  }));

  return { project, files: errors.length ? [] : files, errors, ignored, totalBytes };
}

function filterSourceFiles(raw: RawFile[]) {
  const supported: RawFile[] = [];
  const ignored: Record<string, number> = {};

  for (const item of raw) {
    const path = normalizePath(item.path);
    if (isExcluded(path)) continue;
    if (isSupported(path)) supported.push({ file: item.file, path });
    else {
      const key = extensionOf(item.file.name);
      ignored[key] = (ignored[key] ?? 0) + 1;
    }
  }
  return { supported, ignored };
}

function selectionErrors(supported: RawFile[], totalBytes: number): string[] {
  const errors: string[] = [];
  if (!supported.length) {
    errors.push('所选目录没有未被排除的受支持源码文件');
  }
  if (supported.length > LIMITS.maxFiles) {
    const extra = supported.slice(LIMITS.maxFiles).map((item) => item.path);
    errors.push(`共 ${supported.length} 个源码文件，超过 ${LIMITS.maxFiles} 个限制。超出文件：${extra.slice(0, 12).join('、')}${extra.length > 12 ? ' 等' : ''}`);
  }
  for (const item of supported) {
    if (item.file.size > LIMITS.maxFileBytes) {
      errors.push(`${item.path}：单文件 ${formatBytes(item.file.size)}，超过 ${formatBytes(LIMITS.maxFileBytes)}`);
    }
  }
  if (totalBytes > LIMITS.maxTotalBytes) {
    errors.push(`源码总量 ${formatBytes(totalBytes)}，超过 ${formatBytes(LIMITS.maxTotalBytes)}；请缩小目录范围。`);
  }
  return errors;
}

export function filesFromInput(list: FileList): RawFile[] {
  return [...list].map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { file, path: normalizePath(relative || file.name) };
  });
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, (error: DOMException) => reject(new Error(error.message || '文件读取失败')));
  });
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, (error: DOMException) => reject(new Error(error.message || '目录读取失败')));
  });
}

async function walkEntry(entry: FileSystemEntry, prefix: string, signal: AbortSignal): Promise<RawFile[]> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (entry.isFile) {
    const file = await readEntryFile(entry as FileSystemFileEntry);
    return [{ file, path: prefix + entry.name }];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const output: RawFile[] = [];
  for (;;) {
    const batch = await readDirectoryEntries(reader);
    if (!batch.length) break;
    for (const child of batch) {
      output.push(...(await walkEntry(child, `${prefix}${entry.name}/`, signal)));
    }
  }
  return output;
}

export async function filesFromDataTransfer(
  transfer: DataTransfer,
  signal: AbortSignal,
): Promise<RawFile[]> {
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  const entries: FileSystemEntry[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  if (!entries.length) {
    return [...transfer.files].map((file) => ({ file, path: file.name }));
  }
  const output: RawFile[] = [];
  for (const entry of entries) {
    output.push(...(await walkEntry(entry, '', signal)));
  }
  return output;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
