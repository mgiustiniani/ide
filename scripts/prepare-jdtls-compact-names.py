#!/usr/bin/env python3
"""Build a distinct JDT LS distribution with the compact-class name correction.

The input distribution remains intact. Pinned upstream source and compiler bytes
are required before invoking the pinned Eclipse compiler. The derived compiler is labelled separately;
its source, patch and integrity metadata travel with the resulting distribution.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

RECIPE = Path(__file__).resolve().parent.parent / "tools/jdtls/compact-class-names.json"
PATCH = RECIPE.with_suffix(".patch")
SOURCE_DIRECTORY = Path("source-patches/compact-class-names")
METADATA = SOURCE_DIRECTORY / "build.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_hash(path, expected):
    if not path.is_file() or path.is_symlink() or digest(path) != expected:
        raise ValueError(f"Unexpected or modified input: {path}")


def run(arguments, cwd=None):
    environment = {key: value for key, value in os.environ.items()
                   if key not in ("JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS", "CLASSPATH")}
    result = subprocess.run(arguments, cwd=cwd, env=environment, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise ValueError(f"Build command failed: {Path(arguments[0]).name}\n{result.stdout}{result.stderr}")
    return (result.stdout + result.stderr).strip()


def verify(home):
    home = home.resolve(strict=True)
    recipe = json.loads(RECIPE.read_text())
    metadata = json.loads((home / METADATA).read_text())
    if metadata["recipe"] != recipe or metadata["patchSha256"] != digest(PATCH):
        raise ValueError("The derived compiler does not match the current source-patch recipe")
    require_hash(home / recipe["derivedCompiler"], metadata["compilerSha256"])
    require_hash(home / SOURCE_DIRECTORY / "TypeDeclaration.java", recipe["patchedSourceSha256"])
    require_hash(home / SOURCE_DIRECTORY / PATCH.name, digest(PATCH))
    upstream_jar = home / SOURCE_DIRECTORY / "upstream-compiler.jar"
    require_hash(upstream_jar, recipe["originalCompilerSha256"])
    if (home / recipe["originalCompiler"]).exists():
        raise ValueError("Both original and derived compiler bundles are present")
    configurations = {p.relative_to(home).as_posix(): digest(p) for p in home.glob("config*/config.ini")}
    if configurations != recipe["derivedConfigurationSha256"] or configurations != metadata["configurationSha256"]:
        raise ValueError("The derived launcher configuration changed")
    for name in configurations:
        text = (home / name).read_text()
        if text.count(Path(recipe["derivedCompiler"]).name) != 1 or Path(recipe["originalCompiler"]).name in text:
            raise ValueError("Launcher configuration does not select exactly the derived compiler")
    with zipfile.ZipFile(home / recipe["derivedCompiler"]) as archive:
        code = archive.read(recipe["classEntry"])
        if hashlib.sha256(code).hexdigest() != recipe["derivedClassSha256"] or int.from_bytes(code[6:8], "big") != 61:
            raise ValueError("Derived compiler class is modified or has the wrong Java target")
        with zipfile.ZipFile(upstream_jar) as upstream:
            expected = {name for name in upstream.namelist() if not signature(name)}
            if len(archive.namelist()) != len(expected) or set(archive.namelist()) != expected:
                raise ValueError("Derived bundle has unexpected entries")
            for name in expected:
                if name == recipe["classEntry"]:
                    continue
                wanted = derived_manifest(upstream, recipe) if name == "META-INF/MANIFEST.MF" else upstream.read(name)
                if archive.read(name) != wanted:
                    raise ValueError(f"Unapproved compiler bundle modification: {name}")
    install = json.loads((home / "install-manifest.json").read_text())
    if install["version"] != recipe["derivedJdtlsVersion"] or install["minimumRuntimeJava"] != 25:
        raise ValueError("Derived installation identity does not match")
    return metadata


def signature(name):
    return name.startswith("META-INF/") and name.endswith((".SF", ".RSA", ".DSA", ".EC"))


def derived_manifest(upstream, recipe):
    manifest = upstream.read("META-INF/MANIFEST.MF").decode()
    separator = "\r\n\r\n" if "\r\n\r\n" in manifest else "\n\n"
    main = manifest.split(separator, 1)[0]
    old = "Bundle-Version: " + recipe["originalBundleVersion"]
    if main.count(old) != 1:
        raise ValueError("Unexpected upstream compiler bundle version")
    return (main.replace(old, "Bundle-Version: " + recipe["derivedBundleVersion"]) + separator).encode()


def build(home, destination, source, java_executable):
    recipe = json.loads(RECIPE.read_text())
    home = home.resolve(strict=True)
    source = source.absolute()
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("Refusing an existing output path")
    if destination.resolve().is_relative_to(home):
        raise ValueError("The output cannot be inside the input distribution")
    if any(path.is_symlink() for path in home.rglob("*")):
        raise ValueError("The input distribution contains symbolic links")
    require_hash(source, recipe["sourceSha256"])
    require_hash(home / recipe["originalCompiler"], recipe["originalCompilerSha256"])
    if not (home / "config_linux/config.ini").is_file():
        raise ValueError("JDT LS launcher configuration is absent")
    configurations = {p.relative_to(home).as_posix(): digest(p) for p in home.glob("config*/config.ini")}
    if configurations != recipe["originalConfigurationSha256"]:
        raise ValueError("The input launcher configurations do not match the pinned distribution")
    patch = PATCH.read_text()
    if patch.count("--- a/" + recipe["sourcePath"]) != 1 or patch.count("+++ b/" + recipe["sourcePath"]) != 1 or patch.count("\n--- ") != 0:
        raise ValueError("The patch must modify only the pinned TypeDeclaration source")
    java_executable = Path(java_executable).resolve(strict=True)
    version = run([str(java_executable), "-version"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".jdtls-source-build-", dir=destination.parent) as temporary:
        root = Path(temporary)
        java = root / recipe["sourcePath"]
        java.parent.mkdir(parents=True)
        shutil.copyfile(source, java)
        run(["patch", "--batch", "--forward", "--fuzz=0", "-p1", "-i", str(PATCH)], cwd=root)
        require_hash(java, recipe["patchedSourceSha256"])
        classes = root / "classes"
        classes.mkdir()
        run([str(java_executable), "-jar", str(home / recipe["originalCompiler"]),
             "--release", "17", "-proc:none", "-g:source,lines", "-encoding", "UTF-8",
             "-classpath", str(home / recipe["originalCompiler"]), "-d", str(classes), str(java)])
        compiled = sorted(p.relative_to(classes).as_posix() for p in classes.rglob("*.class"))
        if compiled != [recipe["classEntry"]]:
            raise ValueError("Source compilation produced unexpected classes")
        require_hash(classes / recipe["classEntry"], recipe["derivedClassSha256"])
        stage = root / "server"
        shutil.copytree(home, stage)
        original = stage / recipe["originalCompiler"]
        derived = stage / recipe["derivedCompiler"]
        with zipfile.ZipFile(original) as upstream, zipfile.ZipFile(derived, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr(zipfile.ZipInfo("META-INF/MANIFEST.MF", (1980, 1, 1, 0, 0, 0)), derived_manifest(upstream, recipe))
            for entry in upstream.infolist():
                name = entry.filename
                # An independently rebuilt, separately labelled component cannot
                # retain the upstream signature or its obsolete entry digests.
                if name == "META-INF/MANIFEST.MF" or signature(name):
                    continue
                if name == recipe["classEntry"]:
                    continue
                output.writestr(entry, upstream.read(name))
            output.writestr(zipfile.ZipInfo(recipe["classEntry"], (1980, 1, 1, 0, 0, 0)), (classes / recipe["classEntry"]).read_bytes())
        for configuration in stage.glob("config*/config.ini"):
            text = configuration.read_bytes()
            old = Path(recipe["originalCompiler"]).name.encode()
            if text.count(old) != 1:
                raise ValueError("Unexpected compiler reference in launcher configuration")
            configuration.write_bytes(text.replace(old, Path(recipe["derivedCompiler"]).name.encode()))
        sources = stage / SOURCE_DIRECTORY
        sources.mkdir(parents=True)
        shutil.move(original, sources / "upstream-compiler.jar")
        shutil.copyfile(java, sources / "TypeDeclaration.java")
        shutil.copyfile(PATCH, sources / PATCH.name)
        metadata = {"recipe": recipe, "patchSha256": digest(PATCH), "compilerSha256": digest(derived),
                    "classSha256": digest(classes / recipe["classEntry"]), "buildJavaVersion": version,
                    "buildJavaExecutableSha256": digest(java_executable),
                    "configurationSha256": {p.relative_to(stage).as_posix(): digest(p) for p in stage.glob("config*/config.ini")}}
        (stage / METADATA).write_text(json.dumps(metadata, indent=2) + "\n")
        manifest_path = stage / "install-manifest.json"
        installation = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        installation.update(version=recipe["derivedJdtlsVersion"], upstreamVersion=recipe["upstreamJdtlsVersion"],
                            minimumRuntimeJava=25, derivedCompilerManifest=METADATA.as_posix())
        manifest_path.write_text(json.dumps(installation, indent=2) + "\n")
        verify(stage)
        if destination.exists() or destination.is_symlink():
            raise ValueError("Output path appeared during the build")
        stage.rename(destination)
    return verify(destination)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--input-home", type=Path)
    action.add_argument("--verify-home", type=Path)
    parser.add_argument("--output-home", type=Path)
    parser.add_argument("--source-file", type=Path)
    parser.add_argument("--java")
    args = parser.parse_args()
    if args.verify_home:
        verify(args.verify_home)
        print("Verified derived JDT LS compiler and launcher configurations")
        return
    if not args.output_home or not args.source_file or not args.java:
        parser.error("build requires --output-home, --source-file and --java")
    metadata = build(args.input_home, args.output_home, args.source_file, args.java)
    print(json.dumps({"home": str(args.output_home), "version": metadata["recipe"]["derivedJdtlsVersion"],
                      "compilerSha256": metadata["compilerSha256"]}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(f"prepare-jdtls-compact-names: {error}", file=sys.stderr)
        sys.exit(1)
