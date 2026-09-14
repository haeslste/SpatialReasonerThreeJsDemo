"""A deliberately small, canonical pipeline language for the public workbench.

SRpy 0.1.0 evaluates expressions internally. Only expressions reconstructed from
this typed grammar are ever passed to that package; visitors' raw text is not.
"""

from __future__ import annotations

import ast
import math
import re
from typing import List


class PipelineValidationError(ValueError):
    pass


ALLOWED_OPERATIONS = {"deduce", "filter", "pick", "select", "sort", "slice", "calc", "map"}
ALLOWED_ATTRIBUTES = {
    "id", "label", "type", "supertype", "existence", "cause", "shape", "look",
    "position", "width", "height", "depth", "length", "direction", "thin", "long",
    "equilateral", "real", "virtual", "conceptual", "moving", "perimeter", "footprint",
    "frontface", "sideface", "surface", "baseradius", "volume", "radius", "angle", "yaw",
    "azimuth", "lifespan", "confidence", "immobile", "velocity", "motion", "visible",
    "focused", "volumeLitres", "workbenchScore",
}
NUMERIC_ATTRIBUTES = {
    "width", "height", "depth", "length", "perimeter", "footprint", "frontface",
    "sideface", "surface", "baseradius", "volume", "radius", "angle", "yaw",
    "azimuth", "lifespan", "volumeLitres", "workbenchScore",
}
ALLOWED_PREDICATES = {
    "near", "far", "left", "right", "above", "below", "ahead", "behind", "on",
    "beneath", "upperside", "lowerside", "leftside", "rightside", "frontside", "backside",
    "orthogonal", "opposite", "aligned", "frontaligned", "backaligned", "leftaligned",
    "rightaligned", "disjoint", "inside", "containing", "overlapping", "crossing", "touching",
    "meeting", "beside", "fitting", "exceeding", "smaller", "bigger", "shorter", "longer",
    "taller", "thinner", "wider", "seenleft", "seenright", "infront", "atrear", "tangible",
    "by", "at", "in", "eightoclock", "nineoclock", "tenoclock", "elevenoclock",
    "twelveoclock", "oneoclock", "twooclock", "threeoclock", "fouroclock",
}
DEDUCTION_CATEGORIES = {
    "topology", "connectivity", "comparability", "similarity", "visibility",
    "sectoriality", "geography",
}
_SAFE_TEXT = re.compile(r"[A-Za-z0-9 _:-]{0,160}\Z")
_ASSIGNMENT_KEY = re.compile(r"[A-Za-z][A-Za-z0-9]{0,31}\Z")
_BOOL_WORDS = re.compile(r"\b(AND|OR|NOT)\b", re.IGNORECASE)
_MATH_OPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)
_COMPARE_OPS = (ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE)


def _invalid(message: str = "Pipeline expression is outside the public grammar") -> None:
    raise PipelineValidationError(message)


def _normalize_booleans(source: str) -> str:
    # The accepted string literals cannot contain quote or backslash escapes.
    parts = re.split(r"('[^']*'|\"[^\"]*\")", source)
    return "".join(part if index % 2 else _BOOL_WORDS.sub(lambda m: m.group(1).lower(), part)
                   for index, part in enumerate(parts))


def _tree(source: str) -> ast.expr:
    try:
        root = ast.parse(_normalize_booleans(source), mode="eval")
    except (SyntaxError, ValueError, RecursionError) as exc:
        raise PipelineValidationError("Invalid pipeline expression") from exc
    nodes = list(ast.walk(root))
    if len(nodes) > 24:
        _invalid("Pipeline expression is too complex")

    def depth(node: ast.AST) -> int:
        return 1 + max((depth(child) for child in ast.iter_child_nodes(node)), default=0)

    if depth(root) > 9:
        _invalid("Pipeline expression is too deep")
    return root.body


def _literal(node: ast.expr, *, string_limit: int = 80) -> str:
    if not isinstance(node, ast.Constant):
        _invalid()
    value = node.value
    if isinstance(value, str):
        if len(value) > string_limit or not _SAFE_TEXT.fullmatch(value):
            _invalid("String literal is outside the public grammar")
    elif isinstance(value, bool):
        pass
    elif isinstance(value, (int, float)):
        if abs(value) > 1000 or not math.isfinite(value):
            _invalid("Numeric literal exceeds the public limit")
    else:
        _invalid()
    return repr(value)


def _numeric(node: ast.expr, *, allow_average: bool = False, operation_count: List[int] | None = None) -> str:
    counter = operation_count if operation_count is not None else [0]
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            _invalid("Only numeric values are allowed here")
        return _literal(node)
    if isinstance(node, ast.Name) and node.id in NUMERIC_ATTRIBUTES and not allow_average:
        return node.id
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        counter[0] += 1
        if counter[0] > 4:
            _invalid("Arithmetic expression is too complex")
        sign = "+" if isinstance(node.op, ast.UAdd) else "-"
        return f"({sign}{_numeric(node.operand, allow_average=allow_average, operation_count=counter)})"
    if isinstance(node, ast.BinOp) and isinstance(node.op, _MATH_OPS):
        counter[0] += 1
        if counter[0] > 4:
            _invalid("Arithmetic expression is too complex")
        left = _numeric(node.left, allow_average=allow_average, operation_count=counter)
        right = _numeric(node.right, allow_average=allow_average, operation_count=counter)
        op = {ast.Add: "+", ast.Sub: "-", ast.Mult: "*", ast.Div: "/"}[type(node.op)]
        return f"({left} {op} {right})"
    if allow_average and isinstance(node, ast.Call):
        if (not isinstance(node.func, ast.Name) or node.func.id != "average" or
                len(node.args) != 1 or node.keywords or
                not isinstance(node.args[0], ast.Attribute) or
                not isinstance(node.args[0].value, ast.Name) or
                node.args[0].value.id != "objects" or node.args[0].attr not in NUMERIC_ATTRIBUTES):
            _invalid("Only average(objects.numericField) is allowed")
        return f"average(objects.{node.args[0].attr})"
    _invalid()


def _filter(node: ast.expr) -> str:
    if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
        op = "and" if isinstance(node.op, ast.And) else "or"
        return "(" + f" {op} ".join(_filter(value) for value in node.values) + ")"
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return f"(not {_filter(node.operand)})"
    if isinstance(node, ast.Name) and node.id in {"immobile", "visible", "focused"}:
        return node.id
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], _COMPARE_OPS):
        left = node.left
        right = node.comparators[0]
        if isinstance(left, ast.Name) and left.id in ALLOWED_ATTRIBUTES:
            left_text = left.id
        else:
            left_text = _numeric(left)
        if isinstance(right, ast.Constant):
            right_text = _literal(right)
        elif isinstance(right, ast.Name) and right.id in ALLOWED_ATTRIBUTES:
            right_text = right.id
        else:
            right_text = _numeric(right)
        op = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">="}[type(node.ops[0])]
        return f"({left_text} {op} {right_text})"
    _invalid()


def _relations(node: ast.expr) -> str:
    if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
        op = "and" if isinstance(node.op, ast.And) else "or"
        return "(" + f" {op} ".join(_relations(value) for value in node.values) + ")"
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return f"(not {_relations(node.operand)})"
    if isinstance(node, ast.Name) and node.id in ALLOWED_PREDICATES:
        return node.id
    _invalid("Only relation predicates and boolean operators are allowed here")


def _assignments(source: str, operation: str) -> str:
    parts = source.split(";")
    if not 1 <= len(parts) <= 4:
        _invalid("Use one to four assignments")
    result = []
    for part in parts:
        if "=" not in part:
            _invalid("Assignment requires key = expression")
        key, expression = (value.strip() for value in part.split("=", 1))
        if not _ASSIGNMENT_KEY.fullmatch(key):
            _invalid("Invalid assignment key")
        node = _tree(expression)
        if operation == "map" and key in {"label", "type", "supertype", "look"}:
            value = _literal(node, string_limit=160 if key == "look" else 80)
            if not isinstance(node.value, str):
                _invalid("Text fields require a string literal")
        elif operation == "map" and key in {"volumeLitres", "workbenchScore"}:
            value = _numeric(node)
        elif operation == "calc" and key not in ALLOWED_ATTRIBUTES and key not in {"objects", "average", "base"}:
            value = _numeric(node, allow_average=True)
        else:
            _invalid("Assignment target is not editable")
        result.append(f"{key} = {value}")
    return "; ".join(result)


def validate_pipeline(pipeline: str) -> List[str]:
    """Return canonical stages; never pass the caller's source to SRpy."""
    if len(pipeline) > 800 or any(token in pipeline for token in ("__", "\\", "\n", "\r", "`")):
        _invalid("Pipeline contains blocked content")
    parts = pipeline.split("|")
    if not 1 <= len(parts) <= 12 or any(not part.strip() for part in parts):
        _invalid("Pipeline must contain 1–12 stages")
    operations = []
    for part in parts:
        match = re.fullmatch(r"([a-z]+)\((.*)\)", part.strip())
        if not match or match.group(1) not in ALLOWED_OPERATIONS:
            _invalid("Unknown pipeline operation")
        name, content = match.group(1), match.group(2).strip()
        if name == "deduce":
            categories = content.lower().split()
            if not categories or any(category not in DEDUCTION_CATEGORIES for category in categories):
                _invalid("Unknown deduction category")
            canonical = " ".join(dict.fromkeys(categories))
        elif name == "filter":
            canonical = _filter(_tree(content))
        elif name == "pick":
            canonical = _relations(_tree(content))
        elif name == "select":
            terms = content.split("?")
            if len(terms) > 2:
                _invalid("Select accepts one optional condition")
            canonical = _relations(_tree(terms[0].strip()))
            if len(terms) == 2:
                canonical += " ? " + _filter(_tree(terms[1].strip()))
        elif name == "sort":
            sort = re.fullmatch(r"([A-Za-z][A-Za-z0-9]*)(\.(?:delta|angle))?(?:\s+([<>]))?(?:\s+(\d+))?", content)
            if not sort or sort.group(1) not in ALLOWED_ATTRIBUTES | ALLOWED_PREDICATES:
                _invalid("Invalid sort expression")
            if sort.group(4) and not 1 <= int(sort.group(4)) <= 12:
                _invalid("Sort backtrace is out of range")
            canonical = sort.group(1) + (sort.group(2) or "") + (f" {sort.group(3)}" if sort.group(3) else "") + (f" {int(sort.group(4))}" if sort.group(4) else "")
        elif name == "slice":
            slice_match = re.fullmatch(r"(-?\d+)(?:(\.\.?)(-?\d+))?", content)
            if not slice_match:
                _invalid("Invalid slice range")
            values = [int(slice_match.group(1))]
            if slice_match.group(3) is not None:
                values.append(int(slice_match.group(3)))
            if any(value == 0 or abs(value) > 48 for value in values):
                _invalid("Slice index is out of range")
            canonical = str(values[0]) + (".." + str(values[1]) if len(values) == 2 else "")
        else:
            canonical = _assignments(content, name)
        operations.append(f"{name}({canonical})")
    return operations
