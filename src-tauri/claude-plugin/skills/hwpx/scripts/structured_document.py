"""v2 semantic blocks -> supported generator input, without caller XML."""


def input_findings(spec: dict) -> list[dict]:
    """Warn about decoded literal escapes, without changing intentional examples."""
    findings = []

    def visit(value, pointer):
        if isinstance(value, str):
            if any(token in value for token in (r"\n", r"\r", r"\t")):
                findings.append(
                    {
                        "code": "LITERAL_ESCAPE",
                        "severity": "warning",
                        "pointer": pointer,
                        "context": value[:120],
                        "message": "Decoded text contains a literal escape; check intended display. Text was not changed.",
                    }
                )
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{pointer}/{index}")
        elif isinstance(value, dict):
            for key, item in value.items():
                # File paths and graph IDs are not prose; do not warn on them.
                if key not in {
                    "path",
                    "id",
                    "from",
                    "to",
                    "type",
                    "pattern",
                    "direction",
                }:
                    visit(
                        item, pointer + "/" + key.replace("~", "~0").replace("/", "~1")
                    )

    visit(spec.get("title", ""), "/title")
    visit(spec.get("blocks", []), "/blocks")
    return findings


def diagram_order(diagram: dict) -> list[dict]:
    nodes, edges = diagram["nodes"], diagram["edges"]
    ids = [n["id"] for n in nodes]
    if len(set(ids)) != len(ids):
        raise ValueError("diagram: duplicate node id")
    if any(e["from"] not in ids or e["to"] not in ids for e in edges):
        raise ValueError("diagram: unknown edge endpoint")
    pairs = [(e["from"], e["to"]) for e in edges]
    if diagram["pattern"] in ("process", "swimlane"):
        if pairs != list(zip(ids, ids[1:])):
            raise ValueError(
                "diagram: process/swimlane edges must follow node order; cycles and skipped nodes are unsupported"
            )
    else:
        if pairs != [(ids[0], i) for i in ids[1:]]:
            raise ValueError(
                "diagram: hierarchy currently supports one root and its direct children"
            )
    if diagram["pattern"] == "swimlane" and any(not n.get("role") for n in nodes):
        raise ValueError("diagram: every swimlane node requires a role")
    return nodes


def compile_blocks(spec: dict) -> tuple[str, list[dict]]:
    title = spec["title"]
    meta = spec.get("metadata", {})
    lines = (["---"] + [f"{k}: {v}" for k, v in meta.items()] + ["---"]) if meta else []
    lines += ["# " + title, ""]
    diagrams = []
    for index, block in enumerate(spec["blocks"]):
        kind = block["type"]
        if kind == "heading":
            lines.append("#" * block.get("level", 2) + " " + block["text"])
        elif kind == "paragraph":
            lines.append(block["text"])
        elif kind == "quote":
            lines.append("> " + block["text"])
        elif kind == "list":
            lines.extend("- " + t for t in block["items"])
        elif kind == "pagebreak":
            lines.append("---")
        elif kind == "image":
            lines.append(f"![{block.get('alt', '')}]({block['path']})")
        elif kind == "table":
            headers = block["headers"]
            if any(len(row) != len(headers) for row in block["rows"]):
                raise ValueError(
                    f"blocks.{index}: table row length differs from headers"
                )
            if any(
                "|" in v or "\n" in v for row in [headers] + block["rows"] for v in row
            ):
                raise ValueError(
                    f"blocks.{index}: pipe/newline in table cell is not supported by this adapter"
                )
            lines += [
                "| " + " | ".join(headers) + " |",
                "| " + " | ".join("---" for _ in headers) + " |",
            ]
            lines += ["| " + " | ".join(row) + " |" for row in block["rows"]]
        elif kind == "diagram":
            diagram_order(block)
            marker = f"HWPX_DIAGRAM_{index}_ANCHOR"
            diagrams.append(dict(block, marker=marker))
            lines.append(marker)
        lines.append("")
    return "\n".join(lines), diagrams


def diagram_expected(diagram: dict) -> list[str]:
    nodes = diagram_order(diagram)
    if diagram["pattern"] == "hierarchy":
        return (
            [nodes[0]["title"], nodes[0].get("text", "")]
            + [e.get("label", "") for e in diagram["edges"]]
            + [v for n in nodes[1:] for v in (n["title"], n.get("text", ""))]
        )
    if diagram["pattern"] == "swimlane":
        roles = list(dict.fromkeys(n["role"] for n in nodes))
        return [
            v
            for role in roles
            for v in [role]
            + [
                x
                for n in nodes
                if n["role"] == role
                for x in (n["title"], n.get("text", ""))
            ]
        ]
    values = []
    for i, node in enumerate(nodes):
        values += [node["title"], node.get("text", "")]
        if i < len(diagram["edges"]):
            values.append(diagram["edges"][i].get("label", ""))
    return values
