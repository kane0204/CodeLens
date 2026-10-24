"""四个 skill 的注册表。

注册时校验与 `contract.SKILLS` 一致：信封里声明的 skill 必须真的存在实现，
否则 `validate_skill_result()` 会以 `refused` 拒绝——那是运行期才发现的问题，
放在导入期暴露更好。
"""
from __future__ import annotations

from .. import contract
from .ai_risk_review import SKILL as AI_RISK_REVIEW
from .base import Skill
from .class_node_name import SKILL as CLASS_NODE_NAME
from .logic_summary import SKILL as LOGIC_SUMMARY
from .solid_review import SKILL as SOLID_REVIEW

REGISTRY = {skill.id: skill for skill in (LOGIC_SUMMARY, CLASS_NODE_NAME, AI_RISK_REVIEW, SOLID_REVIEW)}

_missing = sorted(set(contract.SKILLS) - set(REGISTRY))
if _missing:  # pragma: no cover - 导入期自检，出现即代码不一致
    raise RuntimeError("契约声明了未实现的 skill：" + "、".join(_missing))

_extra = sorted(set(REGISTRY) - set(contract.SKILLS))
if _extra:  # pragma: no cover
    raise RuntimeError("实现了未在契约中注册的 skill：" + "、".join(_extra))


def get(skill_id):
    """按 id 取 skill；不存在时返回 None，由 runner 决定如何降级。"""
    return REGISTRY.get(skill_id)


def catalogue():
    """给 `GET /api/ai/status` 用的能力清单（确定性顺序）。"""
    rows = []
    for skill_id in contract.SKILLS:
        skill = REGISTRY[skill_id]
        rows.append({"id": skill.id, "title": skill.title, "version": skill.version,
                     "target_kinds": list(skill.target_kinds),
                     "description": skill.__doc__.strip().splitlines()[0] if skill.__doc__ else ""})
    return rows


__all__ = ["REGISTRY", "Skill", "get", "catalogue"]
