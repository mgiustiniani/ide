/** Lexical runtime-name checks. The selected compiler/JVM decides whether a declaration exists.
 * See JLS 3.8. Control characters are refused at IDE command/protocol boundaries.
 * Strings are never Unicode-normalized: distinct Java names must remain distinct.
 */
const START = "[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}]";
const PART = "[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Cf}]";
const IDENTIFIER = new RegExp(`^${START}${PART}*$`, "u");
const BINARY = new RegExp(`^${START}${PART}*(?:\\.${START}${PART}*)*$`, "u");
const controls = /[\u0000-\u001f\u007f-\u009f]/u;
function bounded(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !controls.test(value) && new TextEncoder().encode(value).length <= 512;
}
export function isJavaRuntimeIdentifier(value: unknown): value is string {
  return bounded(value) && IDENTIFIER.test(value);
}
export function isJavaBinaryName(value: unknown): value is string {
  return bounded(value) && BINARY.test(value);
}
