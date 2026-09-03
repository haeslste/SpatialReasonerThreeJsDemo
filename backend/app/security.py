from __future__ import annotations

import ast
import re
from typing import Iterable, List, Tuple


class PipelineValidationError(ValueError):
    pass


ALLOWED_OPERATIONS = {
    "deduce",
    "filter",
    "pick",
    "select",
    "sort",
    "slice",
    "calc",
    "map",
}

ALLOWED_ATTRIBUTES = {
    "id", "label", "type", "supertype", "existence", "cause", "shape", "look",
    "position", "width", "height", "depth", "length", "direction", "thin", "long",
    "equilateral", "real", "virtual", "conceptual", "moving", "perimeter", "footprint",
    "frontface", "sideface", "surface", "baseradius", "volume", "radius", "angle", "yaw",
    "azimuth", "lifespan", "confidence", "immobile", "velocity", "motion", "visible",
    "focused", "volumeLitres", "workbenchScore",
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

SAFE_NODE_TYPES = (
    ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.Name, ast.Load,
    ast.Constant, ast.And, ast.Or, ast.Not, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod,
    ast.Pow, ast.USub, ast.UAdd, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
)


def _parse_operation(operation: str) -> Tuple[str, str]:
    match = re.fullmatch(r"([a-z]+)\((.*)\)", operation.strip())
    if not match:
        raise PipelineValidationError(f"Invalid operation syntax: {operation!r}")
    name, content = match.groups()
    if name not in ALLOWED_OPERATIONS:
        raise PipelineValidationError(f"Operation {name!r} is not enabled in this demo")
    return name, content.strip()


def _validate_ast(expression: str, allowed_names: Iterable[str]) -> None:
    normalized = re.sub(r"\bAND\b", "and", expression, flags=re.IGNORECASE)
    normalized = re.sub(r"\bOR\b", "or", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\bNOT\b", "not", normalized, flags=re.IGNORECASE)
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as exc:
        raise PipelineValidationError(f"Invalid expression: {expression}") from exc
    for node in ast.walk(tree):
        if not isinstance(node, SAFE_NODE_TYPES):
            raise PipelineValidationError(f"Unsupported expression feature: {type(node).__name__}")
        if isinstance(node, ast.Name) and node.id not in allowed_names and node.id not in {"True", "False", "None"}:
            raise PipelineValidationError(f"Unknown expression name: {node.id}")


def _validate_relation_expression(expression: str) -> None:
    words = re.findall(r"[A-Za-z]+", expression)
    for word in words:
        lowered = word.lower()
        if lowered not in ALLOWED_PREDICATES and lowered not in {"and", "or", "not"}:
            raise PipelineValidationError(f"Unknown relation predicate: {word}")
    _validate_ast(expression, ALLOWED_PREDICATES)


def _validate_assignments(content: str, operation: str) -> None:
    for assignment in content.split(";"):
        if not assignment.strip() or "=" not in assignment:
            raise PipelineValidationError(f"{operation} requires key = expression assignments")
        key, expression = [part.strip() for part in assignment.split("=", 1)]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]{0,31}", key):
            raise PipelineValidationError(f"Unsafe assignment key: {key}")
        if operation == "map":
            if key not in {"label", "type", "supertype", "look", "volumeLitres", "workbenchScore"}:
                raise PipelineValidationError(f"Map assignment key is not editable: {key}")
            _validate_ast(expression, ALLOWED_ATTRIBUTES)
        else:
            # calc supports SRpy's documented objects.height and average(objects.height)
            try:
                tree = ast.parse(expression, mode="eval")
            except SyntaxError as exc:
                raise PipelineValidationError(f"Invalid calc expression: {expression}") from exc
            allowed = SAFE_NODE_TYPES + (ast.Attribute, ast.Call, ast.Subscript)
            for node in ast.walk(tree):
                if not isinstance(node, allowed):
                    raise PipelineValidationError(f"Unsupported calc feature: {type(node).__name__}")
                if isinstance(node, ast.Name) and node.id not in {"objects", "average"}:
                    raise PipelineValidationError(f"Unknown calc name: {node.id}")
                if isinstance(node, ast.Call) and not isinstance(node.func, ast.Name):
                    raise PipelineValidationError("Only average(...) calls are allowed")
                if isinstance(node, ast.Call) and node.func.id != "average":
                    raise PipelineValidationError("Only average(...) calls are allowed")
                if isinstance(node, ast.Attribute) and node.attr not in ALLOWED_ATTRIBUTES:
                    raise PipelineValidationError(f"Unknown object attribute: {node.attr}")


def validate_pipeline(pipeline: str) -> List[str]:
    if any(token in pipeline for token in ("__", "\\", "\n", "\r", "`")):
        raise PipelineValidationError("Pipeline contains a blocked token")
    operations = [part.strip() for part in pipeline.split("|") if part.strip()]
    if not operations or len(operations) > 12:
        raise PipelineValidationError("Pipeline must contain between 1 and 12 operations")

    for operation in operations:
        name, content = _parse_operation(operation)
        if name == "deduce":
            categories = set(re.findall(r"[a-z]+", content.lower()))
            unknown = categories - {"topology", "connectivity", "comparability", "similarity", "visibility", "sectoriality", "geography"}
            if unknown or not categories:
                raise PipelineValidationError(f"Unknown deduce categories: {', '.join(sorted(unknown))}")
        elif name == "filter":
            _validate_ast(content, ALLOWED_ATTRIBUTES)
        elif name == "pick":
            _validate_relation_expression(content)
        elif name == "select":
            parts = [part.strip() for part in content.split("?")]
            if len(parts) > 2:
                raise PipelineValidationError("select accepts at most one ? condition")
            _validate_relation_expression(parts[0])
            if len(parts) == 2:
                _validate_ast(parts[1], ALLOWED_ATTRIBUTES)
        elif name == "sort":
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9]*(?:\.(?:delta|angle))?(?:\s+[<>])?(?:\s+\d+)?", content):
                raise PipelineValidationError("Invalid sort expression")
            attribute = content.split()[0].split(".")[0]
            if attribute not in ALLOWED_ATTRIBUTES and attribute not in ALLOWED_PREDICATES:
                raise PipelineValidationError(f"Unknown sort attribute: {attribute}")
        elif name == "slice":
            if not re.fullmatch(r"-?\d+(?:\.\.?-?\d+)?", content):
                raise PipelineValidationError("slice accepts a 1-based number or range")
        elif name in {"calc", "map"}:
            _validate_assignments(content, name)
    return operations

