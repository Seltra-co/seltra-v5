export type CoreTodoStatus = "pending" | "in_progress" | "completed";
export type CoreTodo = { id: string; content: string; status: CoreTodoStatus };
export type PersistedRunEvent = { type: string; payload?: unknown };
export type RunTodoSnapshot = { chatId?: number; todos: CoreTodo[] };
export type CoreTodoRunOutcome = "running" | "ready" | "degraded" | "failed";
export type TodoEvidence = {
  fileWrittenTodoIds: Set<string>;
  buildPassed: boolean;
  browserQaPassed: boolean;
};

function isCoreTodo(value: unknown): value is CoreTodo {
  if (!value || typeof value !== "object") return false;
  const todo = value as Partial<CoreTodo>;
  return (
    typeof todo.id === "string" &&
    typeof todo.content === "string" &&
    ["pending", "in_progress", "completed"].includes(todo.status ?? "")
  );
}

function isTodoStatus(value: unknown): value is CoreTodoStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed"
  );
}

export function projectTodoStatuses(
  todos: CoreTodo[],
  previousTodos: CoreTodo[],
  evidence: TodoEvidence,
  initialSnapshot = false,
) {
  const previous = new Map(previousTodos.map((todo) => [todo.id, todo.status]));
  return todos.map((todo, index) => {
    if (todo.status !== "completed" || initialSnapshot) return todo;
    const isFinalTodo = index === todos.length - 1;
    if (isFinalTodo) {
      if (evidence.buildPassed && evidence.browserQaPassed) return todo;
      return {
        ...todo,
        status:
          previous.get(todo.id) === "pending"
            ? ("pending" as const)
            : ("in_progress" as const),
      };
    }
    const hasCompletionEvidence =
      previous.get(todo.id) === "completed" ||
      evidence.fileWrittenTodoIds.has(todo.id);
    if (hasCompletionEvidence) return todo;
    return {
      ...todo,
      status:
        previous.get(todo.id) === "in_progress"
          ? ("in_progress" as const)
          : ("pending" as const),
    };
  });
}

export function latestRunTodoSnapshot(
  events?: PersistedRunEvent[],
): RunTodoSnapshot | undefined {
  let snapshot: RunTodoSnapshot | undefined;
  for (const event of events ?? []) {
    if (!event.payload || typeof event.payload !== "object") continue;
    const payload = event.payload as {
      todos?: unknown;
      chatId?: unknown;
      todoId?: unknown;
      status?: unknown;
    };
    if (Array.isArray(payload.todos) && payload.todos.every(isCoreTodo)) {
      snapshot = {
        ...(typeof payload.chatId === "number"
          ? { chatId: payload.chatId }
          : snapshot?.chatId !== undefined
            ? { chatId: snapshot.chatId }
            : {}),
        todos: payload.todos.map((todo) => ({ ...todo })),
      };
      continue;
    }
    if (
      !snapshot ||
      typeof payload.todoId !== "string" ||
      !isTodoStatus(payload.status)
    )
      continue;
    snapshot = {
      ...snapshot,
      todos: snapshot.todos.map((todo) =>
        todo.id === payload.todoId
          ? { ...todo, status: payload.status as CoreTodoStatus }
          : todo,
      ),
    };
  }
  return snapshot;
}

export function hasUnfinishedRunTodos(events?: PersistedRunEvent[]) {
  const snapshot = latestRunTodoSnapshot(events);
  return snapshot
    ? snapshot.todos.some((todo) => todo.status !== "completed")
    : undefined;
}

export function runTodoOutcome(
  events?: PersistedRunEvent[],
): CoreTodoRunOutcome | undefined {
  for (const event of [...(events ?? [])].reverse()) {
    if (
      event.type !== "run.completed" &&
      event.type !== "run.failed" &&
      event.type !== "run.stopped"
    )
      continue;
    if (event.type === "run.failed" || event.type === "run.stopped")
      return "failed";
    const payload = event.payload as { status?: unknown } | undefined;
    return payload?.status === "degraded" ? "degraded" : "ready";
  }
  return undefined;
}
