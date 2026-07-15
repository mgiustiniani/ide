export async function loadMonacoCodeEditor() {
  const module = await import("./MonacoCodeEditor");
  return { default: module.MonacoCodeEditor };
}
