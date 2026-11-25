# Rust Clipboard Dependency

## arboard 3.6.1

- Purpose: explicit, text-only native clipboard reads on Windows, macOS, Linux X11, and Linux Wayland.
- Source: <https://github.com/1Password/arboard>
- License: MIT OR Apache-2.0, at the user's option.
- Configuration: default features are disabled to exclude image clipboard support; only `wayland-data-control` is enabled in addition to arboard's built-in platform text support.

The applicable license texts are distributed by the crate and are available from its source repository.

# JDT LS Runtime Requirement Inspection

## zip 9.5.1

- Purpose: reads the JDT Core bundle manifest to check the language server's Java runtime requirement before startup.
- Source: <https://github.com/zip-rs/zip2>
- License: MIT.
- Configuration: default features are disabled; `deflate-flate2-zlib-rs` enables Deflate decoding. The runtime reads one bounded manifest without extracting archive entries.

The applicable license text is distributed by the crate and is available from its source repository.

# OpenAPI Document Parser

## yaml 2.9.0

- Purpose: parses user-pasted YAML OpenAPI documents locally for route selection in the desktop HTTP client.
- Source: <https://eemeli.org/yaml/>
- License: ISC.
- Configuration: duplicate mapping keys are rejected and alias expansion is bounded; the parser does not resolve remote references.

The applicable license text is distributed by the package and is available from its source repository.

# Java Project Wrapper Templates

The generated Maven and Gradle starter projects include the Maven Wrapper 3.3.4 scripts and Gradle 9.8.0 wrapper launcher. These wrapper files are distributed under the Apache License, Version 2.0. The Gradle launch scripts select a distribution compatible with the build JDK: Gradle 8.14.6 for JDK 8 through 24 and Gradle 9.8.0 for JDK 25 and later. The generated project verifies the selected distribution checksum before use; the IDE does not bundle the full build-tool distributions.

- Gradle source: <https://github.com/gradle/gradle>
- Maven Wrapper source: <https://maven.apache.org/tools/wrapper/>
- License: <https://www.apache.org/licenses/LICENSE-2.0>

# Native HTTP Client

## reqwest 0.13.4

- Purpose: sends requests explicitly submitted through the desktop HTTP client using the Rustls transport.
- Source: <https://github.com/seanmonstar/reqwest>
- License: MIT OR Apache-2.0, at the user's option.
- Configuration: default features are disabled; HTTP/2, Rustls, streaming responses, and system-proxy support are enabled.

The applicable license texts are distributed by the crate and are available from its source repository.

# Java Class-File Name Decoding

## cesu8 1.1.0

- Purpose: decodes the JVM class-file format's modified UTF-8 binary names before compiled-class identity checks, including supplementary characters.
- Source: <https://github.com/emk/cesu8-rs>.
- License: Apache-2.0 OR MIT, at the user's option.
- Configuration: the existing locked dependency is also used directly; class-file input and identity limits remain bounded, and invalid encodings are rejected.

The applicable license texts are distributed by the crate and are available from its source repository.
