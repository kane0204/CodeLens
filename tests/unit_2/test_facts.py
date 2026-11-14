"""Behavioral tests for AST control-flow and local def-use evidence."""
import ast
import sys
import unittest
from pathlib import Path
from textwrap import dedent

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "code"))
from core_engine.facts import MAX_DEF_USE_NAMES, MAX_FLOW_STATEMENTS, build_control_flow, build_def_use
from core_engine import facts


def function(source):
    return ast.parse(dedent(source)).body[0]


def labeled_edges(flow):
    labels = {block["id"]: block["labels"][0] for block in flow["blocks"]}
    return {(labels[source], labels[target], kind) for source, target, kind in flow["edges"]}


class FactsTests(unittest.TestCase):
    def test_block_termination_distinguishes_conditional_and_fallthrough_paths(self):
        cases = [
            ("", False),
            ("return value", True),
            ("if flag:\n    return 1\nelse:\n    raise ValueError", True),
            ("if flag:\n    return 1", False),
            ("try:\n    raise ValueError\nexcept ValueError:\n    return 1", True),
            ("value = 1", False),
        ]
        for source, expected in cases:
            with self.subTest(source=source):
                self.assertEqual(facts._terminates(ast.parse(source).body), expected)

    def test_block_merge_handles_empty_graph_and_keeps_join_and_branch_leaders(self):
        flow = facts._Flow()
        flow.edge(None, None, "seq")
        self.assertEqual(facts._merge_blocks(flow), ([], []))
        entry = flow.add(1, 1, "entry", "entry", 0)
        branch = flow.add(2, 2, "simple", "condition target", 1)
        join = flow.add(3, 3, "simple", "join", 0)
        flow.edge(entry, branch, "true")
        flow.edge(branch, join, "seq")
        flow.edge(entry, join, "seq")
        blocks, edges = facts._merge_blocks(flow)
        self.assertEqual([block["labels"] for block in blocks], [["entry"], ["condition target"], ["join"]])
        self.assertEqual(edges, [[1, 2, "true"], [1, 3, "seq"], [2, 3, "seq"]])

    def test_pattern_label_uses_unknown_for_an_unrecognized_ast_node(self):
        self.assertEqual(facts._pattern_name(ast.AST()), "?")

    def test_control_flow_keeps_branches_and_omits_unreachable_statements(self):
        flow = build_control_flow(function("""\
            def run(flag):
                if flag:
                    return 1
                    dead()
                else:
                    raise ValueError
                dead()
            """))
        self.assertTrue(flow["available"])
        self.assertIn(("if", "then", "true"), labeled_edges(flow))
        self.assertIn(("if", "else", "false"), labeled_edges(flow))
        by_kind = {block["kinds"][0]: block["line"] for block in flow["blocks"]}
        self.assertEqual((by_kind["if"], by_kind["return"], by_kind["raise"]), (2, 3, 6))
        self.assertNotIn("simple", by_kind)
        self.assertNotIn("exit", by_kind)

    def test_loop_with_empty_transformed_body_keeps_exhaustion_edge(self):
        node = function("def run(items):\n    for item in items:\n        pass\n    else:\n        return 0")
        node.body[0].body.clear()
        edges = labeled_edges(build_control_flow(node))
        self.assertIn(("for", "for-else", "exhausted"), edges)
        self.assertFalse(any(kind in {"loop", "back"} for _, _, kind in edges))

    def test_loops_emit_back_edges_and_normal_exhaustion(self):
        flow = build_control_flow(function("""\
            async def run(stream):
                async for item in stream:
                    if item:
                        continue
                    break
                else:
                    report()
                while ready():
                    step()
                else:
                    reset()
            """))
        edges = labeled_edges(flow)
        self.assertTrue({
            ("async for", "body", "loop"),
            ("continue", "async for", "back"),
            ("async for", "for-else", "exhausted"),
            ("while", "body", "true"),
            ("while", "while-else", "exhausted"),
        }.issubset(edges))
        self.assertTrue(any(edge[1:] == ("while", "back") for edge in edges))
        self.assertTrue(any("exit" in block["kinds"] for block in flow["blocks"]))

    def test_exception_context_and_pattern_edges_have_distinct_labels(self):
        flow = build_control_flow(function("""\
            def run(obj):
                try:
                    with lock():
                        handle(obj)
                except (pkg.Error, ValueError):
                    recover()
                except:
                    report()
                else:
                    commit()
                finally:
                    cleanup()
                match obj:
                    case 0: zero()
                    case None: missing()
                    case [first, *rest]: sequence()
                    case {"key": value}: mapping()
                    case Point(x, y): point()
                    case 1 | 2: small()
                    case _: unknown()
            """))
        edges = labeled_edges(flow)
        self.assertIn(("try", "except pkg.Error|ValueError", "except"), edges)
        self.assertIn(("try", "except (bare)", "except"), edges)
        self.assertIn(("try", "finally", "finally"), edges)
        self.assertIn(("with", "with-body", "seq"), edges)
        self.assertEqual({target for source, target, kind in edges if source == "match" and kind == "case"},
                         {"case value", "case singleton", "case sequence", "case mapping",
                          "case class", "case or", "case _"})

    def test_control_flow_refuses_oversized_body_without_partial_graph(self):
        count = MAX_FLOW_STATEMENTS + 1
        result = build_control_flow(function("def run():\n" + "    pass\n" * count))
        self.assertFalse(result["available"])
        self.assertEqual(result["statement_count"], count)
        self.assertNotIn("blocks", result)

    def test_dynamic_exception_and_capture_patterns_do_not_invent_type_names(self):
        flow = build_control_flow(function("""\
            def run(obj):
                while condition():
                    try:
                        work()
                    except make_type():
                        recover()
                match obj:
                    case 1 as bound:
                        use(bound)
                finish()
            """))
        edges = labeled_edges(flow)
        self.assertIn(("try", "except ?", "except"), edges)
        self.assertIn(("match", "case as", "case"), edges)
        self.assertFalse(any(kind == "exhausted" for _, _, kind in edges))

    def test_def_use_tracks_argument_kinds_and_nested_scope_boundaries(self):
        facts = build_def_use(function("""\
            def run(first, /, *args, step, **kwargs):
                global total
                value = first
                value += step
                if (found := value):
                    total = found
                try:
                    return args, kwargs
                except ValueError as error:
                    handle(error)
                def nested():
                    return ignored
            """))
        names = {entry["name"]: (entry["defs"], entry["uses"]) for entry in facts["names"]}
        self.assertEqual(set(facts["params"]), {"first", "args", "step", "kwargs"})
        self.assertEqual(names["value"], ([3, 4], [4, 5]))
        self.assertEqual(names["found"], ([5], [6]))
        self.assertEqual(names["total"], ([2, 6], []))
        self.assertEqual(names["error"], ([9], [10]))
        self.assertNotIn("ignored", names)

    def test_def_use_truncates_in_name_order(self):
        count = MAX_DEF_USE_NAMES + 1
        body = "".join(f"    var_{i:04} = 0\n" for i in reversed(range(count)))
        result = build_def_use(function("def run():\n" + body))
        self.assertTrue(result["truncated"])
        self.assertEqual([entry["name"] for entry in result["names"]],
                         [f"var_{i:04}" for i in range(MAX_DEF_USE_NAMES)])
