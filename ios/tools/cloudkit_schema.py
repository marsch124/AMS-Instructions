#!/usr/bin/env python3
"""The app's CloudKit schema, derived from the SwiftData models.

    cloudkit_schema.py write   regenerate ios/Config/CloudKitSchema.ckdb
    cloudkit_schema.py check   fail if the .ckdb is stale or misses a model property

SwiftData syncs through Core Data's CloudKit mirroring, which names things the
documented way: a record type CD_<Model> per model, a field CD_<property> per
stored property, plus CD_entityName. Strings are STRING, Int and Bool INT64,
Date TIMESTAMP. Data, arrays and anything encoded is BYTES, and large values
of those go into a CKAsset in CD_<property>_ckAsset.

Fields deployed to the Production environment can never be changed or
removed, so the check below runs on every build: a stored property added to a
model without a matching field here stops the build, instead of quietly never
syncing.
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MODELS = [ROOT / "AMSInstructions/Models/Instruction.swift",
          ROOT / "AMSInstructions/Models/OtherModels.swift"]
SCHEMA = ROOT / "Config/CloudKitSchema.ckdb"

SYSTEM_FIELDS = [
    ('"___createTime"', "TIMESTAMP"),
    ('"___createdBy"', "REFERENCE"),
    ('"___etag"', "STRING"),
    ('"___modTime"', "TIMESTAMP"),
    ('"___modifiedBy"', "REFERENCE"),
    ('"___recordID"', "REFERENCE QUERYABLE"),
]


def cloudkit_types(swift_type: str):
    """CloudKit field(s) for one stored Swift property type."""
    base = swift_type.rstrip("?").strip()
    if base == "String":
        return ["STRING"]
    if base in ("Int", "Bool", "Int64", "Int32"):
        return ["INT64"]
    if base == "Double":
        return ["DOUBLE"]
    if base == "Date":
        return ["TIMESTAMP"]
    # Data, arrays and Codable values are stored as bytes, spilling into an
    # asset when large.
    return ["BYTES", "ASSET"]


def models():
    """{model: [(property, swift type)]} for every @Model class, in order."""
    found = {}
    for path in MODELS:
        current = None
        depth = 0
        after_model_macro = False
        for line in path.read_text().splitlines():
            declared = re.match(r"\s*final class (\w+)", line)
            if declared and after_model_macro:
                current, depth = declared.group(1), 0
                found[current] = []
            after_model_macro = line.strip() == "@Model"
            if current is None:
                continue
            depth += line.count("{") - line.count("}")
            # Stored properties sit at the class's top level and have no body
            # (computed ones end in "{" and are skipped).
            prop = re.match(r"\s*(?:@Attribute\([^)]*\)\s*)?var (\w+): ([^={]+?)\s*(=[^{]*)?$", line)
            if prop and depth == 1:
                found[current].append((prop.group(1), prop.group(2).strip()))
            if depth <= 0 and "}" in line:
                current = None
    return found


def render() -> str:
    out = ["DEFINE SCHEMA", ""]
    for model, props in models().items():
        fields = list(SYSTEM_FIELDS) + [("CD_entityName", "STRING")]
        for name, swift_type in props:
            types = cloudkit_types(swift_type)
            fields.append((f"CD_{name}", types[0]))
            if "ASSET" in types:
                fields.append((f"CD_{name}_ckAsset", "ASSET"))
        width = max(len(f[0]) for f in fields)
        out.append(f"    RECORD TYPE CD_{model} (")
        for field, kind in fields:
            out.append(f"        {field.ljust(width)} {kind},")
        out.append('        GRANT WRITE TO "_creator",')
        out.append('        GRANT CREATE TO "_icloud",')
        out.append('        GRANT READ TO "_world"')
        out.append("    );")
        out.append("")
    out += [
        "    RECORD TYPE Users (",
        '        "___createTime" TIMESTAMP,',
        '        "___createdBy"  REFERENCE,',
        '        "___etag"       STRING,',
        '        "___modTime"    TIMESTAMP,',
        '        "___modifiedBy" REFERENCE,',
        '        "___recordID"   REFERENCE,',
        "        roles           LIST<INT64>,",
        '        GRANT WRITE TO "_creator",',
        '        GRANT READ TO "_world"',
        "    );",
        "",
    ]
    return "\n".join(out)


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    expected = render()
    if command == "write":
        SCHEMA.write_text(expected)
        print(f"Wrote {SCHEMA.relative_to(ROOT.parent)}")
        return 0
    found = models()
    if not found or any(not props for props in found.values()):
        print("::error::Could not read the SwiftData models to check the CloudKit schema.")
        return 1
    if not SCHEMA.exists() or SCHEMA.read_text() != expected:
        print("::error::ios/Config/CloudKitSchema.ckdb does not match the SwiftData models. "
              "Run: python3 ios/tools/cloudkit_schema.py write — and remember that fields "
              "already deployed to Production can never change type or be removed.")
        return 1
    total = sum(len(p) for p in found.values())
    print(f"CloudKit schema matches the models: {len(found)} record types, {total} properties.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
