import { useMemo, useState } from 'react';
import { useApp } from '../state/AppState';
import { FileTree } from '../components/FileTree';
import { Icon } from '../components/Icon';
import { Button, Card, CardHeader, EmptyState } from '../components/Ui';

export function StructureView() {
  const { result, file, selectFile, openFunction, treeSearch, setTreeSearch, openSource, go } = useApp();
  const [packageSort, setPackageSort] = useState(false);
  if (!result) return null;

  const selected = result.files.find((item) => item.path === file);

  const packages = useMemo(() => {
    const map = new Map<string, { name: string; files: number; symbols: number; dependencies: number }>();
    const packageOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '（根目录）');
    const packageOfModule = (module: string): string | null => {
      const candidates = result.files
        .filter((item) => module === item.module || module.startsWith(`${item.module}.`))
        .sort((a, b) => b.path.length - a.path.length);
      return candidates[0] ? packageOf(candidates[0].path) : null;
    };
    for (const item of result.files) {
      const name = packageOf(item.path);
      if (!map.has(name)) map.set(name, { name, files: 0, symbols: 0, dependencies: 0 });
      const row = map.get(name);
      if (!row) continue;
      row.files += 1;
      row.symbols += item.functions.length + result.classes.filter((cls) => cls.file === item.path).length;
    }
    for (const edge of result.graph?.dependencies ?? []) {
      if (!edge.target) continue;
      const name = packageOfModule(edge.target);
      if (name && map.has(name)) {
        const row = map.get(name);
        if (row) row.dependencies += 1;
      }
    }
    return [...map.values()].sort((a, b) =>
      packageSort ? b.dependencies - a.dependencies || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
    );
  }, [result, packageSort]);

  const languages = Object.entries(result.language_counts ?? {});

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[290px_minmax(0,1fr)]">
      <Card className="min-h-0">
        <CardHeader
          title="项目文件"
          icon="folder"
          actions={<span className="num text-[10px] text-faint">{result.files.length}</span>}
        />
        <FileTree
          files={result.files}
          classes={result.classes}
          selected={file}
          search={treeSearch}
          onSearch={setTreeSearch}
          onSelect={selectFile}
        />
      </Card>

      <div className="grid min-h-0 grid-rows-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-3">
        <Card className="min-h-0">
          <CardHeader
            title="模块 / 包结构"
            icon="layers"
            subtitle={
              languages.length
                ? languages.map(([name, count]) => `${name} ${count}`).join(' · ')
                : undefined
            }
            actions={
              <Button size="sm" variant="ghost" onClick={() => setPackageSort((value) => !value)}>
                按被依赖次数 {packageSort ? '↓' : '↕'}
              </Button>
            }
          />
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>包路径</th>
                  <th className="w-16 text-right">文件数</th>
                  <th className="w-28 text-right">符号数</th>
                  <th className="w-20 text-right">被依赖</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((row) => (
                  <tr key={row.name}>
                    <td className="num max-w-[420px] truncate" title={row.name}>
                      {row.name}
                    </td>
                    <td className="num text-right text-muted">{row.files}</td>
                    <td className="num text-right text-muted">{row.symbols}</td>
                    <td className="num text-right">
                      <span className={row.dependencies ? 'font-medium text-primary' : 'text-faint'}>{row.dependencies}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!packages.length ? <EmptyState compact title="引擎未产出文件列表" /> : null}
          </div>
          <p className="shrink-0 border-t border-line px-3 py-1.5 text-[10px] text-faint">
            被依赖次数按依赖目标所属包聚合；符号数包含函数与类。
          </p>
        </Card>

        <Card className="min-h-0">
            <CardHeader
              title="选中文件符号"
              icon="code"
              subtitle={selected ? <span className="num">{selected.path}</span> : '未选择文件'}
              actions={
                selected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      selectFile(selected.path);
                      go('logic');
                    }}
                  >
                    查看文件逻辑
                    <Icon name="arrowRight" size={11} />
                  </Button>
                ) : null
              }
            />
            <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2">
              {selected ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">函数</span>
                    <span className="num text-[10px] text-faint">{selected.functions.length}</span>
                  </div>
                  {selected.functions.length ? (
                    <ul className="mb-3 space-y-0.5">
                      {selected.functions.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-2 rounded-[3px] px-1 py-0.5 hover:bg-[#fdfbf8]">
                          <button
                            type="button"
                            className="num min-w-0 flex-1 truncate text-left text-[11px] text-[#57534e] hover:text-primary"
                            title={item.id}
                            onClick={() => openFunction(item.id)}
                          >
                            {item.id}
                          </button>
                          <span className="num shrink-0 text-[10px] text-faint">
                            L{item.line} · CC {item.cc}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mb-3 text-[11px] text-faint">此文件没有函数定义</p>
                  )}
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">类</span>
                    <span className="num text-[10px] text-faint">
                      {result.classes.filter((cls) => cls.file === selected.path).length}
                    </span>
                  </div>
                  {result.classes.filter((cls) => cls.file === selected.path).length ? (
                    <ul className="space-y-0.5">
                      {result.classes
                        .filter((cls) => cls.file === selected.path)
                        .map((cls) => (
                          <li key={cls.id} className="flex items-center justify-between gap-2 rounded-[3px] px-1 py-0.5 hover:bg-[#fdfbf8]">
                            <span className="num min-w-0 truncate text-[11px] text-[#57534e]" title={cls.id}>
                              {cls.id}
                            </span>
                            <button
                              type="button"
                              className="shrink-0 text-[10.5px] text-primary hover:underline"
                              onClick={() =>
                                openSource({ title: '类定义', path: cls.file, line: cls.line, endLine: cls.end_line })
                              }
                            >
                              源码
                            </button>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-faint">此文件没有类定义</p>
                  )}
                </>
              ) : (
                <EmptyState compact title="在左侧文件树中选择一个文件" />
              )}
            </div>
          </Card>
      </div>
    </div>
  );
}
