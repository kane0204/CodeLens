# CodeLens 单元测试

- [Python](unit/) 使用标准库 `unittest`，覆盖分析引擎、证据索引、AI 审查、风险与指标，以及内存中的 HTTP 适配层。
- [JavaScript / TypeScript](frontend/) 使用 Vitest 和 jsdom，覆盖文件导入、API、审查流、报告导出、工作台状态与组件交互。

单元测试模拟外部模型和网络请求。实际本机 HTTP 集成测试位于 [tests/integration](../tests/integration/)。

[复杂度回归测试](unit/test_project_complexity.py) 随 Python 单元测试运行，复扫后端、前端和 DDD 设计示例。每个函数的圈复杂度、有效行数和嵌套深度分别不得超过 8、50 和 4。

## 运行和查看覆盖率

在仓库根目录运行 Python 测试。只执行单元测试时可以直接运行 `python -B -m unittest discover -s doc/unit -v`。

```sh
python -m pip install -r doc/requirements-test.txt
python -B -m coverage run --rcfile=doc/.coveragerc -m unittest discover -s doc/unit -v
python -B -m coverage report --rcfile=doc/.coveragerc
python -B -m coverage html --rcfile=doc/.coveragerc
```

前端测试需要 Node.js 22.12+（22 系列）或 24+。

```sh
cd codelens-prototype
npm ci
npm run test:coverage
npm run build
```

行覆盖率以 `code/` 下 Python 可执行语句及 `codelens-prototype/src/` 下可执行 TypeScript/TSX 源码为统计范围。报告包含未执行的生产文件，Python 也计入原有的 `no cover` 行。前端同时列出语句、分支和函数覆盖率。HTML 报告分别生成在仓库根目录的 `htmlcov/python/` 和 `htmlcov/frontend/`。

## 100% 行覆盖率验收

运行下列命令。行覆盖率低于 100% 时，命令以非零状态退出。

```sh
# 仓库根目录，先运行上述 Python 覆盖率测试
python -B -m coverage report --rcfile=doc/.coveragerc --fail-under=100
# codelens-prototype 目录
npm run test:coverage:check
```
