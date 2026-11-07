import { useMemo } from 'react';
import type { ClassInfo, FileInfo } from '../types';
import { Icon } from './Icon';

interface TreeFile extends FileInfo {
  classCount: number;
}

interface DirNode {
  dirs: Map<string, DirNode>;
  files: TreeFile[];
}

function buildTree(files: FileInfo[], classes: ClassInfo[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  const classCount = new Map<string, number>();
  for (const item of classes) classCount.set(item.file, (classCount.get(item.file) ?? 0) + 1);
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part) as DirNode;
    }
    node.files.push({ ...file, classCount: classCount.get(file.path) ?? 0 });
  }
  return root;
}

function Directory({ node, depth, selected, onSelect }: { node: DirNode; depth: number; selected: string; onSelect: (path: string) => void }) {
  return (
    <>
      {[...node.dirs.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, child]) => (
          <details key={name} open className="group">
            <summary
              className="flex h-7 items-center gap-1 rounded-[3px] pr-1 text-[11.5px] text-[#57534e] hover:bg-[#f7f3ec]"
              style={{ paddingLeft: depth * 10 + 4 }}
            >
              <Icon name="chevronRight" size={11} className="shrink-0 text-faint transition-transform group-open:rotate-90" />
              <Icon name="folder" size={12} className="shrink-0 text-[#a88c6c]" />
              <span className="truncate">{name}</span>
            </summary>
            <Directory node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
          </details>
        ))}
      {node.files
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => {
          const error = file.status === 'error';
          const classCount = file.classCount;
          return (
            <button
              key={file.path}
              type="button"
              title={file.path}
              onClick={() => onSelect(file.path)}
              className={`flex w-full items-center gap-1.5 rounded-[3px] py-1 pr-1.5 text-left text-[11.5px] transition-colors ${
                selected === file.path ? 'bg-tint text-primary' : 'text-[#57534e] hover:bg-[#f7f3ec]'
              }`}
              style={{ paddingLeft: depth * 10 + 20 }}
            >
              <Icon name={error ? 'alert' : 'file'} size={11} className={`shrink-0 ${error ? 'text-danger' : 'text-faint'}`} />
              <span className={`min-w-0 flex-1 truncate ${error ? 'text-danger' : ''}`}>{file.path.split('/').pop()}</span>
              <span className="num shrink-0 text-[9.5px] text-faint">
                {file.functions.length} 函数 / {classCount} 类
              </span>
            </button>
          );
        })}
    </>
  );
}

interface FileTreeProps {
  files: FileInfo[];
  classes: ClassInfo[];
  selected: string;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (path: string) => void;
}

export function FileTree({ files, classes, selected, search, onSearch, onSelect }: FileTreeProps) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [files, search]);

  const tree = useMemo(() => buildTree(filtered, classes), [filtered, classes]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-2.5 pb-2 pt-2">
        <Icon name="search" size={12} className="pointer-events-none absolute left-4 top-[17px] text-faint" />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="搜索文件路径"
          aria-label="搜索文件路径"
          className="h-7 w-full rounded-[4px] border border-line bg-card pl-7 pr-2 text-[11px] outline-none transition-colors placeholder:text-faint focus:border-primary"
        />
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {filtered.length ? (
          <Directory node={tree} depth={0} selected={selected} onSelect={onSelect} />
        ) : (
          <p className="px-2 py-4 text-[11px] text-faint">没有匹配的文件</p>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-line px-2.5 py-1.5 text-[10px] text-faint">
        <span>
          {filtered.length} / {files.length} 个文件
        </span>
        <span className="num">{classes.length} 个类</span>
      </div>
    </div>
  );
}
