/**
 * errorMessage.ts — sanitize tRPC/server errors into clean user-facing strings.
 *
 * Rules:
 *  1. Network failures → friendly connectivity message
 *  2. Raw SQL / Drizzle errors → generic "couldn't save" message (never show SQL to users)
 *  3. INTERNAL_SERVER_ERROR → generic server error
 *  4. Zod validation JSON arrays → human-readable field message
 *  5. Short, safe messages → show as-is
 *  6. Anything else → generic fallback
 */

export function sanitizeError(err: unknown, fallback = "Something went wrong — please try again."): string {
  const rawMsg = err instanceof Error ? err.message : String(err ?? "");

  // Class 1: Network / fetch failure
  if (/failed to fetch|network error|load failed|networkerror/i.test(rawMsg)) {
    return "Network error — check your connection and try again.";
  }

  // Class 2: Postgres / Drizzle query error (raw SQL leaked)
  if (/failed query|syntax error|column.*does not exist|relation.*does not exist|invalid input syntax|violates.*constraint|duplicate key|foreign key/i.test(rawMsg)) {
    return "An error occurred. Please refresh the page. If this keeps happening, contact support.";
  }

  // Class 3: tRPC INTERNAL_SERVER_ERROR
  if (/INTERNAL_SERVER_ERROR|internal server error/i.test(rawMsg)) {
    return "Server error — please refresh and try again.";
  }

  // Class 4: Zod validation error (JSON array of issues)
  const stripped = rawMsg
    .replace(/^TRPCClientError:\s*/i, "")
    .replace(/^(Save|Update|Create|Delete) failed:\s*/i, "");

  try {
    const zodIssues = JSON.parse(stripped) as Array<{ path: (string | number)[]; message: string }>;
    if (Array.isArray(zodIssues) && zodIssues[0]?.message) {
      const issue = zodIssues[0];
      const pathStr = issue.path.length > 0 ? ` (${issue.path.join(" → ")})` : "";
      return `Validation error: ${issue.message}${pathStr}`;
    }
  } catch {
    // not JSON
  }

  // Class 5: Short, readable message — safe to show
  if (stripped.length > 0 && stripped.length < 120 && !/select|insert|update|delete|from|where|join/i.test(stripped)) {
    return stripped;
  }

  return fallback;
}
