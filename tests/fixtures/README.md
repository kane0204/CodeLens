# 测试 Fixtures（tests/fixtures）

W2-02「Python 3.11 样例项目集」的落地：供算法文档举例、单元测试规则验证、
集成测试端到端与 golden 对拍使用。

## 结构

```text
fixtures/
├── projects/                    # 样例项目（backlog W2-02 要求入库位置）
│   ├── ai_generated_shop/       # 主力端到端样例：AI 风格电商代码
│   │   ├── README.md            #   场景与覆盖点
│   │   └── expected/            #   人工标注（scan/logic/graph/metrics/findings）
│   └── circular_deps/           # 结构视图样例：循环依赖 + 同名类 + 动态基类
│       ├── README.md
│       └── expected/
├── snippets/                    # 规则正反例最小片段
│   ├── smells.py / solid.py / ai_risk.py
│   └── INDEX.md                 # 规则 → 行号 → 预期结果映射 + 覆盖度
└── VERIFICATION.md              # 与真实引擎的端到端对拍记录
```

## 使用约定

1. **不得执行 fixtures 里的代码**（SRS C-01）：两个样例项目都刻意含有
   import 即失败的特征（未导入的 `send_email`、不存在的 `thirdparty_gateway`、
   循环导入），这是 AI 生成代码的典型形态，静态分析必须在不执行的前提下工作。
2. `expected/` 是人工标注的基准答案（tests/integration/README.md 约定）：
   逻辑对拍逐条比对，图对拍比节点/边集合，指标对拍容差 ±5%。
3. 上传路径形态：集成测试必须以**项目目录为根**发送根相对路径
   （与浏览器 `webkitRelativePath` 剥离根目录的行为一致），否则模块名不匹配
   导致内部依赖漏检——见 `VERIFICATION.md`「已知边界」。
4. 标注中的 provisional 规则 ID 以 `docs/algorithm/rules-engine.md` 定稿为准；
   引擎已实现规则以 `VERIFICATION.md` 实测为准。

## 与 Backlog 的对应

| Backlog | 状态 |
|---|---|
| W2-02 样例项目集（≥3 个，含 AI 生成代码，附人工标注） | 2 个项目 + 1 个片段库已入库并标注；第 3 个项目（如 legacy-snippets 级联样例）待 W2-12 评估基准定稿后补 |
| W2-12 评估基准 | 正反例计数与缺口清单见 `snippets/INDEX.md`，evaluation.md 待测试负责人建 |

## 基线工具

- radon 6.0.1（SRS R4，开发期对拍基准，仅装进开发 venv，不进运行时依赖）
- AST 统计脚本（语句数 / 嵌套深度 / 参数个数），口径见 `expected/metrics.md`
