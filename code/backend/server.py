"""Loopback-only web adapter; source stays in memory and is never executed."""
import argparse
import json
import secrets
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

CODE_ROOT = Path(__file__).resolve().parents[1]
if str(CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(CODE_ROOT))

from core_engine.engine import analyze, VERSION
from core_engine import health
from core_engine import rules as extra_rules
from core_engine import sequence
from core_engine.ir import build_index
from ai import contract as ai_contract
from ai import provider as ai_provider
from ai import runner as ai_runner
from ai import skills as ai_skills

ROOT = CODE_ROOT / "frontend"
TOKEN = secrets.token_urlsafe(32)
MAX_BODY = 12 * 1024 * 1024
MAX_AI_TARGETS = ai_runner.MAX_TARGETS
STATIC = {"/":("index.html","text/html"),"/index.html":("index.html","text/html"),
          "/app.js":("app.js","text/javascript"),"/styles.css":("styles.css","text/css")}
# 前端按模块拆成多份静态资源，这里只放行 ROOT 下这几个目录与这几种扩展名。
ASSET_DIRS = ("lib", "views", "features", "assets")
ASSET_TYPES = {".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".woff2":"font/woff2"}


def ai_error(code, message):
    """AI 接口的错误体：结构化的 code 便于前端区分"没开""没证据""参数错"。"""
    return {"error": {"code": code, "message": message}}


# 补充规则单列在这里：引擎 config.rules 仍然只列引擎自己执行的规则，
# 前端靠这份清单判断「设计检查」页该展示哪几条。
EXTRA_RULE_IDS = ("SRP-01", "OCP-01", "DIP-01", "A5-DEAD", "A8-DEFENSIVE")


def merge_extra(result):
    """把补充规则（S/O/D、死代码、防御式捕获）并入引擎结果，返回 (merged, extra)。

    只新增 findings 与 config.rules 里的规则名，不改动引擎已产出的键值。
    """
    extra = extra_rules.evaluate(result)
    merged = extra_rules.merge(result, extra)
    config = merged.get("config")
    if not isinstance(config, dict):
        config = {}
        merged["config"] = config
    ids = [item for item in (config.get("rules") or []) if isinstance(item, str)]
    for rule_id in EXTRA_RULE_IDS:
        if rule_id not in ids:
            ids.append(rule_id)
    config["rules"] = ids
    merged["extra_rules"] = {
        "findings": len(extra.get("findings") or []),
        "metrics": extra.get("metrics") or {},
        "notes": list(extra.get("notes") or []),
    }
    return merged, extra


def enrich(result):
    """analyze() 之后补齐三样前端需要的派生数据：补充规则、健康度得分、时序序列。

    三者都是确定性计算，不含模型、不含随机；analyze() 本身的返回契约不受影响。
    """
    if not isinstance(result, dict) or result.get("status") in ("empty", "failed"):
        return result
    merged, _ = merge_extra(result)
    merged = health.apply(merged)
    merged["sequence"] = sequence.build(merged)
    return merged



def ai_status():
    """AI 层的自述：有哪些 skill、当前用哪个 provider、各项上限是多少。"""
    provider, degraded = ai_provider.resolve_provider()
    return {
        "ready": True,
        "enabled": True,
        "template_only": provider.kind == "template",
        "providers": [item.describe() for item in ai_provider.candidates()],
        "skills": ai_skills.catalogue(),
        "limits": {
            "max_targets": ai_runner.MAX_TARGETS,
            "max_claims_per_result": ai_contract.MAX_CLAIMS_PER_RESULT,
            "max_claim_chars": ai_contract.MAX_CLAIM_CHARS,
        },
        "degraded": degraded,
        "limitations": list(ai_runner.LIMITATIONS),
    }


def ai_analyze(payload):
    """跑一次 AI 表达层。事实层仍然是 `analyze()`，这里只做"把事实讲清楚"。"""
    if not isinstance(payload, dict):
        raise ai_contract.SkillError("refused", "请求必须是 JSON 对象")
    skills = payload.get("skills")
    if not isinstance(skills, list) or not skills:
        raise ai_contract.SkillError("refused", "skills 必须是非空数组")
    unknown = [item for item in skills if item not in ai_contract.SKILLS]
    if unknown:
        raise ai_contract.SkillError("refused", "未注册的 skill：" + "、".join(str(x)[:40] for x in unknown[:4]))
    targets = payload.get("targets")
    if targets is not None:
        if not isinstance(targets, list) or not all(isinstance(item, str) for item in targets):
            raise ai_contract.SkillError("refused", "targets 必须是字符串数组或 null")
        if len(targets) > MAX_AI_TARGETS:
            raise ai_contract.SkillError("refused", "targets 超过上限 " + str(MAX_AI_TARGETS))
    options = payload.get("options") or {}
    if not isinstance(options, dict):
        raise ai_contract.SkillError("refused", "options 必须是对象")
    include_text = options.get("include_text", True) is not False

    result = analyze({"project": payload.get("project"), "files": payload.get("files") or []})
    if result.get("status") in ("empty", "failed"):
        return {
            "schema_version": ai_contract.SCHEMA_VERSION,
            "engine_version": VERSION,
            "project": result.get("project"),
            "targets": [],
            "results": [],
            "summary": {"requested": 0, "ok": 0, "insufficient_evidence": 0,
                        "need_more": 0, "refused": 0,
                        "citations": {"count": 0, "resolved": 0, "unresolved": 0, "coverage": 0.0}},
            "warnings": [{"code": "no-source", "message": "本次没有可分析的源码，AI 层未执行。"}],
            "limitations": list(ai_runner.LIMITATIONS),
        }

    # 补充规则（SOLID 的 S/O/D、A5、A8）只并入这条 AI 路径，不改 analyze() 的契约。
    merged, extra = merge_extra(result)
    index = build_index(merged)
    env = ai_runner.build_env(index, rules=extra)
    env["ensure_trees"]()
    provider, degraded = ai_provider.resolve_provider()
    outcome = ai_runner.Runner(env, provider=provider).run(skills, targets=targets)

    results = outcome["results"]
    if not include_text:
        for item in results:
            item["outputs"] = {}
            item["notes"] = []
    warnings = list(outcome["warnings"])
    if degraded:
        warnings.append({"code": "provider-fallback",
                         "message": "外部模型不可用，已退回确定性模板：" + degraded})
    if extra.get("notes"):
        warnings.append({"code": "extra-rules", "message": "；".join(extra["notes"])})
    return {
        "schema_version": ai_contract.SCHEMA_VERSION,
        "engine_version": VERSION,
        "project": result.get("project"),
        "targets": [item["target"] for item in results],
        "results": results,
        "summary": outcome["summary"],
        "warnings": warnings,
        "limitations": list(outcome["limitations"]),
    }


def resolve_asset(path):
    """把请求路径映射到 ROOT 内的真实文件；不在白名单内一律返回 None（含目录穿越）。"""
    if path in STATIC:
        name, mime = STATIC[path]
        return ROOT / name, mime
    if ".." in path or "\\" in path or "//" in path:
        return None
    parts = [seg for seg in path.split("/") if seg]
    if len(parts) < 2 or parts[0] not in ASSET_DIRS:
        return None
    # 最后一段是文件名：允许 stem 与单个后缀；中间目录只允许字母数字/-_。
    stem, dot, suffix = parts[-1].rpartition(".")
    if not dot or not stem or stem.startswith("."):
        return None
    if not all(ch.isalnum() or ch in "-_" for ch in stem):
        return None
    mime = ASSET_TYPES.get("." + suffix)
    if mime is None:
        return None
    for seg in parts[:-1]:
        if seg.startswith(".") or not all(ch.isalnum() or ch in "-_" for ch in seg):
            return None
    root = ROOT.resolve()
    candidate = root.joinpath(*parts).resolve()
    if candidate != root and root not in candidate.parents:
        return None
    if not candidate.is_file():
        return None
    return candidate, mime


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        # No source, project names or request payloads in logs.
        pass

    def send_data(self, status, body, mime="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body,ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(data)

    def allowed_host(self):
        return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def do_GET(self):
        if not self.allowed_host():
            return self.send_data(403,{"error":"只允许本机访问"})
        path = urlsplit(self.path).path
        if path == "/api/status":
            return self.send_data(200,{"ready":True,"engine_version":VERSION,"token":TOKEN})
        if path == "/api/ai/status":
            return self.send_data(200, ai_status())
        asset = resolve_asset(path)
        if asset is None:
            return self.send_data(404,{"error":"路径不存在"})
        try:
            return self.send_data(200,asset[0].read_bytes(),asset[1])
        except OSError:
            return self.send_data(404,{"error":"路径不存在"})

    def do_POST(self):
        origin = self.headers.get("Origin")
        origins = {f"http://127.0.0.1:{self.server.server_port}",f"http://localhost:{self.server.server_port}"}
        if not self.allowed_host() or origin not in origins or self.headers.get("X-CodeLens-Token") != TOKEN:
            return self.send_data(403,{"error":"请从本机 CodeLens 页面发起分析"})
        path = urlsplit(self.path).path
        if path not in ("/api/analyze", "/api/ai"):
            return self.send_data(404,{"error":"接口不存在"})
        is_ai = path == "/api/ai"
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_data(415,{"error":"仅支持 JSON 请求"})
        try:
            length = int(self.headers.get("Content-Length","0"))
            if not 0 < length <= MAX_BODY:
                return self.send_data(413,{"error":"请求超过 12 MB 或为空"})
            self.connection.settimeout(30)
            data = self.rfile.read(length)
            if len(data) != length:
                raise ValueError("请求数据不完整")
            payload = json.loads(data)
            if is_ai:
                return self.send_data(200, ai_analyze(payload))
            return self.send_data(200, enrich(analyze(payload)))
        except ai_contract.SkillError as exc:
            if is_ai:
                return self.send_data(400, ai_error(exc.kind, str(exc)[:200]))
            return self.send_data(400,{"error":str(exc)[:200]})
        except (ValueError, UnicodeError, TypeError) as exc:
            self.send_data(400,{"error":str(exc)[:200]})
        except Exception:
            if is_ai:
                return self.send_data(500, ai_error("internal", "AI 解读失败；未生成替代结论"))
            self.send_data(500,{"error":"分析失败，请缩小项目范围后重试；未生成替代结果"})


def main():
    parser = argparse.ArgumentParser(description="CodeLens 本机真实 Python 静态分析")
    parser.add_argument("--port",type=int,default=18766)
    args = parser.parse_args()
    if sys.version_info < (3,11):
        raise SystemExit("需要 Python 3.11 或更高版本")
    try:
        server = ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    except OSError as exc:
        raise SystemExit(f"无法启动端口 {args.port}，可使用 --port 更换端口：{exc}")
    print(f"CodeLens {VERSION}: http://127.0.0.1:{args.port}",flush=True)
    print("Select a project folder in your browser. Ctrl+C to stop.",flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
