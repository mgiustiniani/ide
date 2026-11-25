#!/usr/bin/env python3
"""Qualify the source-derived JDT compiler against a real JDK and integrity controls."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("jdt_patch", ROOT / "scripts/prepare-jdtls-compact-names.py")
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)
OPTIONS = None


class CompactNames(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="ide-jdt-qualification-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = OPTIONS.derived_home.resolve(strict=True)
        self.recipe = json.loads(patcher.RECIPE.read_text())

    def changed_home(self):
        home = self.root / "modified-server"
        shutil.copytree(self.home, home)
        return home

    def rewrite_jar(self, home, name):
        jar = home / self.recipe["derivedCompiler"]
        rebuilt = jar.with_suffix(".modified.jar")
        with zipfile.ZipFile(jar) as original, zipfile.ZipFile(rebuilt, "w") as changed:
            for entry in original.infolist():
                data = original.read(entry.filename)
                changed.writestr(entry, data + b"\0" if entry.filename == name else data)
        rebuilt.replace(jar)
        metadata = json.loads((home / patcher.METADATA).read_text())
        metadata["compilerSha256"] = patcher.digest(jar)
        (home / patcher.METADATA).write_text(json.dumps(metadata))

    def test_source_derived_distribution_is_verified(self):
        metadata = patcher.verify(self.home)
        self.assertEqual(metadata["classSha256"], self.recipe["derivedClassSha256"])

    def test_changed_compiler_class_is_rejected_even_with_rewritten_metadata(self):
        home = self.changed_home()
        self.rewrite_jar(home, self.recipe["classEntry"])
        with self.assertRaisesRegex(ValueError, "Derived compiler class"):
            patcher.verify(home)

    def test_an_unrelated_compiler_class_cannot_be_changed(self):
        home = self.changed_home()
        self.rewrite_jar(home, "org/eclipse/jdt/internal/compiler/Compiler.class")
        with self.assertRaisesRegex(ValueError, "Unapproved compiler bundle modification"):
            patcher.verify(home)

    def test_configuration_cannot_be_changed_by_rewriting_its_digest(self):
        home = self.changed_home()
        file = home / "config_linux/config.ini"
        file.write_bytes(file.read_bytes() + b"\nextra.configuration=true\n")
        metadata = json.loads((home / patcher.METADATA).read_text())
        metadata["configurationSha256"]["config_linux/config.ini"] = patcher.digest(file)
        (home / patcher.METADATA).write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, "launcher configuration changed"):
            patcher.verify(home)

    def test_modified_distributed_source_is_rejected(self):
        home = self.changed_home()
        source = home / patcher.SOURCE_DIRECTORY / "TypeDeclaration.java"
        source.write_bytes(source.read_bytes() + b"\n")
        with self.assertRaisesRegex(ValueError, "Unexpected or modified input"):
            patcher.verify(home)

    def test_existing_output_and_untrusted_source_never_invoke_java(self):
        source = self.root / "untrusted.java"
        source.write_text("Untrusted source must never execute a compiler")
        output = self.root / "existing"
        output.mkdir()
        sentinel = output / "preserve.txt"
        sentinel.write_text("developer data")
        with mock.patch.object(patcher, "run", side_effect=AssertionError("Java must not run")):
            with self.assertRaisesRegex(ValueError, "existing output"):
                patcher.build(self.home, output, source, OPTIONS.jdk_home / "bin/java")
            with self.assertRaisesRegex(ValueError, "Unexpected or modified input"):
                patcher.build(self.home, self.root / "new-output", source, OPTIONS.jdk_home / "bin/java")
        self.assertEqual(sentinel.read_text(), "developer data")
        self.assertFalse((self.root / "new-output").exists())

    def test_compiler_matrix_agrees_with_javac(self):
        patcher.verify(self.home)
        original = self.home / patcher.SOURCE_DIRECTORY / "upstream-compiler.jar"
        derived = self.home / self.recipe["derivedCompiler"]
        cases = [("compact-" + name, name + ".java", "void main() { int compactWarning = 1; }\n", 25, True)
                 for name in ("record", "var", "yield", "sealed", "permits", "IO", "Entry", "cla\u200css")]
        cases += [("explicit-" + name, name + ".java", "class " + name + " { public static void main(String[] args) {} }\n", 25, False)
                  for name in ("record", "var", "yield", "sealed", "permits")]
        cases += [("compact-error", "record.java", "void main() { int value = missingCompactValue; }\n", 25, False),
                  ("ordinary-error", "Entry.java", "class Entry { int value = missingCompactValue; }\n", 25, False),
                  ("unsupported-release", "Entry.java", "void main() {}\n", 21, False)]
        results = []
        for label, filename, content, release, success in cases:
            with self.subTest(case=label):
                folder = OPTIONS.artifacts / label
                folder.mkdir(parents=True, exist_ok=False)
                source = folder / filename
                source.write_text(content)
                row = {"case": label, "expectedSuccess": success, "release": release}
                for tool, jar in (("original", original), ("derived", derived), ("javac", None)):
                    classes = folder / (tool + "-classes")
                    classes.mkdir()
                    command = [str(OPTIONS.jdk_home / "bin/java"), "-jar", str(jar)] if jar else [str(OPTIONS.jdk_home / "bin/javac")]
                    command += ["--release", str(release), "-proc:none", "-d", str(classes), str(source)]
                    environment = {k: v for k, v in os.environ.items() if k not in ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH")}
                    result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=30)
                    (folder / (tool + ".log")).write_text(result.stdout + result.stderr)
                    row[tool] = {"exitCode": result.returncode, "classFiles": sorted(p.name for p in classes.glob("*.class"))}
                    if tool in ("derived", "javac"):
                        self.assertEqual(result.returncode == 0, success, (label, tool, result.stdout, result.stderr))
                        if success:
                            self.assertTrue((classes / (filename[:-5] + ".class")).is_file())
                    if label == "compact-error" and tool == "derived":
                        self.assertIn("missingCompactValue", result.stdout + result.stderr)
                        self.assertNotIn("restricted identifier", result.stdout + result.stderr)
                if label.startswith("compact-") and success and filename[:-5] in ("record", "var", "yield", "sealed", "permits"):
                    self.assertNotEqual(row["original"]["exitCode"], 0)
                results.append(row)
        (OPTIONS.artifacts / "matrix-verification.json").write_text(json.dumps({
            "passed": len(results) == len(cases), "cases": len(results), "compilerInvocations": 3 * len(results),
            "jdkHome": str(OPTIONS.jdk_home), "derivedCompilerSha256": patcher.digest(derived), "results": results,
        }, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--derived-home", type=Path, required=True)
    parser.add_argument("--jdk-home", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    OPTIONS, unittest_args = parser.parse_known_args()
    if OPTIONS.artifacts.exists():
        parser.error("--artifacts must be a new directory")
    OPTIONS.artifacts = OPTIONS.artifacts.absolute()
    OPTIONS.artifacts.mkdir(parents=True)
    OPTIONS.jdk_home = OPTIONS.jdk_home.resolve(strict=True)
    unittest.main(argv=[sys.argv[0], *unittest_args])
