#!/bin/sh
set -eu
umask 077
maven=$1
directory=$2
mode=$3
shift 3

fail() {
    printf '%s\n' "$1" >&2
    exit 125
}

case " $* ${MAVEN_ARGS:-} ${MAVEN_OPTS:-} " in
    *maven.ext.class.path*)
        fail 'The IDE Maven test launcher cannot combine Maven extension class paths.'
        ;;
esac
for config in .mvn/maven.config .mvn/jvm.config; do
    if [ -f "$config" ] && grep -q 'maven\.ext\.class\.path' "$config"; then
        fail 'The IDE Maven test launcher cannot combine Maven extension class paths.'
    fi
done

version=$("$maven" --version -B -Dstyle.color=never) ||
    fail 'The IDE Maven test launcher could not inspect the selected Maven.'
maven_home=$(printf '%s\n' "$version" | sed -n 's/^Maven home: //p')
case "$version" in
    *'Apache Maven 3.9.'*) ;;
    *) fail 'The IDE Maven test launcher requires Maven 3.9.' ;;
esac
[ -n "$maven_home" ] && [ -d "$maven_home/lib" ] ||
    fail 'The selected Maven does not expose its runtime libraries.'

classes=$directory/classes
mkdir -p "$classes/META-INF/plexus"
cp "$directory/components.xml" "$classes/META-INF/plexus/components.xml"
"$JAVA_HOME/bin/javac" -Xlint:-options -source 8 -target 8 -cp "$maven_home/lib/*" \
    -d "$classes" "$directory/ForkLauncher.java"
"$JAVA_HOME/bin/jar" cf "$directory/extension.jar" -C "$classes" .
case "$mode" in
    forks) set -- "-Dide.maven.test.forks=$directory/forks" "$@" ;;
    rerun-test|rerun-integration-test)
        set -- "-Dide.maven.test.rerun=$directory/rerun" "-Dide.maven.test.phase=$mode" "$@"
        if [ -f "$directory/forks" ]; then
            set -- "-Dide.maven.test.forks=$directory/forks" "$@"
        fi
        ;;
    *) fail 'Unknown IDE Maven test launch mode.' ;;
esac
exec "$maven" "-Dmaven.ext.class.path=$directory/extension.jar" "$@"
