#!/bin/sh
set -eu
IDE_REAL_JAVA
if [ "${JAVA_HOME:-}" = "${0%/bin/java}" ]; then
    # Surefire derives JAVA_HOME from its configured executable unless the POM overrides it.
    export JAVA_HOME="${real_java%/bin/java}"
fi
if [ "$#" -eq 1 ] && [ "$1" = "-version" ]; then
    exec "$real_java" "$@"
fi

# Rotate the existing JVM arguments and insert the IDE options before the test entry point.
remaining=$#
while [ "$remaining" -gt 0 ]; do
    case "$1" in
        -jar)
            case "${2##*/}" in
                surefirebooter-*.jar) break ;;
            esac
            ;;
        -cp|-classpath)
            if [ "${3:-}" = "org.apache.maven.surefire.booter.ForkedBooter" ]; then break; fi
            ;;
        -m|--module)
            case "${2:-}" in
                */org.apache.maven.surefire.booter.ForkedBooter) break ;;
            esac
            ;;
        org.apache.maven.surefire.booter.ForkedBooter) break ;;
    esac
    argument=$1
    shift
    set -- "$@" "$argument"
    remaining=$((remaining - 1))
done
if [ "$remaining" -eq 0 ]; then
    printf '%s\n' 'The IDE could not recognize the Maven test fork entry point.' >&2
    exit 125
fi
set -- "$@" IDE_JVM_OPTIONS
while [ "$remaining" -gt 0 ]; do
    argument=$1
    shift
    set -- "$@" "$argument"
    remaining=$((remaining - 1))
done
exec "$real_java" "$@"
