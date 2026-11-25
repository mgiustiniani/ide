import { useEffect, useMemo, useRef, useState } from "react";
import type { JavaTestCaseResult, JavaTestResults } from "@ide/contracts";

export type JavaTestSourceTarget = Pick<JavaTestCaseResult, "className"> &
  Partial<Pick<JavaTestCaseResult, "state" | "detail" | "detailTruncated" | "methodSource">>;
export type JavaTestSourceContext = Pick<JavaTestResults, "projectPath"> &
  Partial<Pick<JavaTestResults, "buildTool" | "suites">>;
export type OpenJavaTestSource = (
  test: JavaTestSourceTarget,
  context: JavaTestSourceContext,
  isCurrent: () => boolean,
) => Promise<void>;

/** Progress updates refresh the action without retiring navigation in the same language session. */
export function useJavaTestSourceAction(action: OpenJavaTestSource, context: {
  workspaceId: string | null;
  generation: number;
  languageGeneration: number | null;
}) {
  const key = JSON.stringify([context.workspaceId, context.generation, context.languageGeneration]);
  const current = useRef({ action, key });
  current.current = { action, key };
  return useMemo<OpenJavaTestSource>(() => async (test, results, isCurrent) => {
    if (current.current.key !== key || !isCurrent()) return;
    await current.current.action(test, results, isCurrent);
  }, [key]);
}

/** A source request belongs to the displayed discovery or report and its current action. */
export function useJavaTestSourceRequest<Test extends { id: string }, Context>(
  context: Context,
  action?: (test: Test, context: Context, isCurrent: () => boolean) => Promise<void>,
) {
  const lifecycle = useRef({ context, action, request: null as object | null });
  if (lifecycle.current.context !== context || lifecycle.current.action !== action)
    lifecycle.current = { context, action, request: null };
  const owner = lifecycle.current;
  const [navigation, setNavigation] = useState<{
    owner: object; testId: string | null; error: string | null;
  } | null>(null);
  useEffect(() => {
    lifecycle.current = owner;
    return () => {
      if (lifecycle.current === owner) lifecycle.current = { context, action, request: null };
      owner.request = null;
    };
  }, [owner, context, action]);

  async function openSource(test: Test) {
    if (!action || lifecycle.current !== owner || owner.request !== null) return;
    const request = {};
    owner.request = request;
    const isCurrent = () => lifecycle.current === owner && owner.request === request;
    setNavigation({ owner, testId: test.id, error: null });
    let error: string | null = null;
    try {
      await action(test, context, isCurrent);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not open the Java test source.";
    } finally {
      if (isCurrent()) {
        owner.request = null;
        setNavigation({ owner, testId: null, error });
      }
    }
  }
  return {
    openingTestId: navigation?.owner === owner ? navigation.testId : null,
    sourceError: navigation?.owner === owner ? navigation.error : null,
    openSource,
  };
}
