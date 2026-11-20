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

export const EXCLUDED_DIRS = [
  '.git', '.venv', 'venv', '__pycache__', 'node_modules', 'build', 'dist', 'tests',
  'htmlcov', 'tmp', '.tmp', '.next', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'logs',
];
const EXCLUDED_TEST_DIRS = new Set(['doc/unit', 'doc/frontend']);

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
  return parts.some((part, index) =>
    EXCLUDED_DIRS.includes(part) || EXCLUDED_TEST_DIRS.has(parts.slice(index, index + 2).join('/')),
  );
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

async function collectEntries(
  entry: FileSystemEntry, prefix: string, signal: AbortSignal,
  output: Array<{ entry: FileSystemFileEntry; path: string }>,
): Promise<void> {
  signal.throwIfAborted();
  const path = prefix + entry.name;
  if (entry.isFile) {
    if (!isExcluded(path)) output.push({ entry: entry as FileSystemFileEntry, path });
    return;
  }
  if (!entry.isDirectory || isExcluded(`${path}/_`)) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    signal.throwIfAborted();
    const batch = await readDirectoryEntries(reader);
    if (!batch.length) break;
    for (const child of batch) {
      await collectEntries(child, `${path}/`, signal, output);
    }
  }
}

export async function filesFromDataTransfer(
  transfer: DataTransfer,
  signal: AbortSignal,
): Promise<RawFile[]> {
  signal.throwIfAborted();
  const items = [...transfer.items].filter((item) => item.kind === 'file');
  const sources = items.map((item) => ({ item, entry: item.webkitGetAsEntry?.() }));
  const entries = sources.flatMap(({ entry }) => entry ? [entry] : []);
  if (!entries.length) return filesFromInput(transfer.files);
  const fallback = sources.flatMap(({ item, entry }) => entry ? [] : [item.getAsFile()]);
  const fileEntries: Array<{ entry: FileSystemFileEntry; path: string }> = [];
  const output: RawFile[] = [];
  for (const entry of entries) {
    await collectEntries(entry, '', signal, fileEntries);
  }
  const batchSize = 16;
  for (let offset = 0; offset < fileEntries.length; offset += batchSize) {
    signal.throwIfAborted();
    const files = await Promise.all(fileEntries.slice(offset, offset + batchSize).map(async ({ entry, path }) => ({
      path, file: await readEntryFile(entry),
    })));
    output.push(...files);
  }
  signal.throwIfAborted();
  for (const file of fallback) if (file) output.push({ file, path: file.name });
  return output;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
