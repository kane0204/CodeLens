#!/usr/bin/env bash
#
# CodeLens · GitHub 协作设施初始化脚本
#
# 作用：按 docs/mgmt/project-setup.md 与 docs/mgmt/backlog.md 批量创建
#       标签（Labels）、里程碑（Milestones）与初始 Issue。
#
# 前置条件：
#   1. 已安装 GitHub CLI（https://cli.github.com/）并执行过 `gh auth login`；
#   2. 在仓库根目录执行本脚本（脚本会从 git remote 推断目标仓库）。
#
# 用法：
#   bash docs/mgmt/scripts/gh-bootstrap.sh
#
# 说明：Projects 看板需在网页创建，或使用 `gh project create`（需要 project 权限，
#       见脚本末尾注释）。

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "未找到 gh 命令，请先安装 GitHub CLI：https://cli.github.com/" >&2
  exit 1
fi

REPO="${REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
echo "目标仓库：$REPO"

# ---------------------------------------------------------------------------
# 1. 标签
# ---------------------------------------------------------------------------
echo "==> 创建标签"

labels=(
  "type: feature|0E8A16|新功能"
  "type: task|1D76DB|计划内任务"
  "type: bug|D73A4A|缺陷"
  "type: docs|0075CA|文档"
  "type: test|5319E7|测试"
  "type: checkpoint|FBCA04|对外提交/检查点"
  "priority: P0|B60205|阻塞：必须优先处理"
  "priority: P1|D93F0B|严重：核心功能受损"
  "priority: P2|FBCA04|一般：影响体验"
  "priority: P3|C2E0C6|轻微"
  "status: awaiting-review|BFD4F2|等待外部反馈"
  "status: blocked|E99695|被阻塞"
  "status: discussion|D4C5F9|需要讨论"
  "area: core_engine|006B75|核心引擎"
  "area: backend|0E8A16|后端"
  "area: frontend|1D76DB|前端"
  "area: docs|0075CA|文档"
  "area: ci|5319E7|构建与流水线"
  "good first issue|7057FF|适合新人承接"
  "help wanted|008672|需要支援"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  gh label create "$name" --color "$color" --description "$desc" --force >/dev/null
  echo "  标签 OK：$name"
done

# ---------------------------------------------------------------------------
# 2. 里程碑
# ---------------------------------------------------------------------------
echo "==> 创建里程碑"

create_milestone() {
  local title="$1" desc="$2"
  if gh api "repos/$REPO/milestones" --paginate -q '.[].title' | grep -Fxq "$title"; then
    echo "  里程碑已存在：$title"
  else
    gh api -X POST "repos/$REPO/milestones" -f title="$title" -f description="$desc" >/dev/null
    echo "  里程碑 OK：$title"
  fi
}

create_milestone "W1 立项与问题定义" "仓库 + README + 三个看板 + 5W1H 与产品描述；提交仓库链接获取第一轮反馈"
create_milestone "W2 需求与算法设计" "用户故事、用例、算法方案；完成需求评审"
create_milestone "W3 架构与骨架" "架构文档、接口定义、端到端最小链路；完成设计评审"
create_milestone "W4-W6 MVP" "F1-F3 功能闭环与测试，通过迭代演示"

# ---------------------------------------------------------------------------
# 3. 初始 Issue
# ---------------------------------------------------------------------------
echo "==> 创建初始 Issue"

new_issue() {
  local title="$1" body="$2" labels="$3" milestone="$4"
  local args=(issue create --repo "$REPO" --title "$title" --body "$body")
  [ -n "$labels" ] && args+=(--label "$labels")
  [ -n "$milestone" ] && args+=(--milestone "$milestone")
  gh "${args[@]}" >/dev/null
  echo "  Issue OK：$title"
}

new_issue \
  "[任务] W1-01 建立仓库结构与协作规范" \
  "依据 README.md 的『项目结构』与 docs/mgmt/branching-and-commit.md 完成仓库初始化。\n\n验收标准：\n1. 目录结构符合规范；\n2. main / develop 分支就位；\n3. README、CONTRIBUTING、Issue/PR 模板齐备。" \
  "type: task,area: docs" \
  "W1 立项与问题定义"

new_issue \
  "[任务] W1-02 建立三个 Projects 看板" \
  "按 docs/mgmt/project-setup.md 第 2 节建立 Team planning、Kanban、Bug tracker，并配置列与自定义字段。\n\n验收标准：看板链接可访问，列名与字段与文档一致。" \
  "type: task" \
  "W1 立项与问题定义"

new_issue \
  "[任务] W1-04 配置标签与里程碑" \
  "执行 bash docs/mgmt/scripts/gh-bootstrap.sh 或按 docs/mgmt/project-setup.md 第 3、4 节手工创建。\n\n验收标准：标签与里程碑与文档一致。" \
  "type: task" \
  "W1 立项与问题定义"

new_issue \
  "[需求] 支持 C/C++ 代码的结构化解读" \
  "首期以 Python 为主，但课程作业以 C/C++ 为主，需要评估扩展成本。\n\n验收标准：给出解析层语言插件的接口约定与工作量估算。" \
  "type: feature,area: core_engine" \
  "W2 需求与算法设计"

new_issue \
  "[任务] W2-02 痛点假设小样本调研（≥8 人）" \
  "验证 docs/requirements/problem_definition.md 中标注 ⚠️ 的假设：分组提示接受度、助教答疑负担、数据隐私关注度。\n\n验收标准：输出调研记录并回填文档。" \
  "type: task" \
  "W2 需求与算法设计"

new_issue \
  "[任务] W3-05 CI 接入测试与静态检查" \
  "在现有结构检查基础上，接入 pytest 与前端 lint，红灯阻断合并。\n\n验收标准：PR 触发流水线并正确阻断不合规改动。" \
  "type: task,area: ci" \
  "W3 架构与骨架"

echo
echo "完成。请继续："
echo "  1) 在网页创建三个 Projects 看板（或 gh project create），把链接填入 README 与检查点 Issue；"
echo "  2) 用『检查点 · 第 1 周』模板创建 Issue 并提交仓库链接。"
