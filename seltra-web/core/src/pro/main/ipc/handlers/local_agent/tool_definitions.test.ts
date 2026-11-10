import { describe, expect, it, vi } from "vitest";

import {
  BUILD_MODE_TOOL_NAMES,
  shouldIncludeTool,
  buildAgentToolSet,
  estimateAgentToolTokens,
  estimateBuildModeToolTokens,
  TOOL_DEFINITIONS,
} from "./tool_definitions";

describe("Build mode tool profile", () => {
  it("is an exact, non-sub-agent allowlist with explicitly authorized engine capabilities", () => {
    expect(BUILD_MODE_TOOL_NAMES).toEqual([
      "generate_image",
      "repair_app",
      "write_file",
      "search_replace",
      "copy_file",
      "delete_file",
      "rename_file",
      "add_dependency",
      "execute_sql",
      "read_file",
      "list_files",
      "grep",
      "get_supabase_project_info",
      "get_neon_project_info",
      "get_database_table_schema",
      "set_chat_summary",
      "add_integration",
      "enable_nitro",
      "restart_app",
      "reinstall_and_restart_app",
      "update_todos",
      "run_shell",
      "run_build",
      "read_guide",
      "write_app_blueprint",
      "read_experiment_artifacts",
      "write_experiment_artifacts",
    ]);

    const definitions = new Map(
      TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
    );
    for (const name of BUILD_MODE_TOOL_NAMES) {
      const definition = definitions.get(name);
      expect(
        definition,
        `${name} must exist in TOOL_DEFINITIONS`,
      ).toBeDefined();
      if (definition?.usesEngineEndpoint) {
        expect(definition.allowInFreeModelMode, name).toBe(true);
      }
      expect(definition?.subagentOnly, name).not.toBe(true);
    }
  });

  it("accounts for serialized Build tool declarations", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };

    const withoutBlueprint = await estimateBuildModeToolTokens(baseOptions);
    const withBlueprint = await estimateBuildModeToolTokens({
      ...baseOptions,
      enableAppBlueprint: true,
    });

    expect(withoutBlueprint).toBeGreaterThan(1_000);
    expect(withBlueprint).toBeGreaterThan(withoutBlueprint);
  });

  it("accounts for tool declarations in every agent-backed mode", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };

    await expect(
      estimateAgentToolTokens({ ...baseOptions, readOnly: true }),
    ).resolves.toBeGreaterThan(0);
    await expect(
      estimateAgentToolTokens({ ...baseOptions, planModeOnly: true }),
    ).resolves.toBeGreaterThan(0);
    await expect(estimateAgentToolTokens(baseOptions)).resolves.toBeGreaterThan(
      0,
    );
  });

  it("accounts for connected MCP tool declarations in Agent mode", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };
    const withoutMcp = await estimateAgentToolTokens(baseOptions);
    const withMcp = await estimateAgentToolTokens({
      ...baseOptions,
      mcpToolDefs: [
        {
          jsName: "test_server__large_tool",
          toolKey: "test-server__large-tool",
          serverId: 1,
          serverName: "test-server",
          toolName: "large-tool",
          description: "A connected MCP tool with a declaration to count.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          },
        },
      ],
    });

    expect(withMcp).toBeGreaterThan(withoutMcp);
  });

  it("uses runtime provider-tool availability when estimating declarations", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: "supabase-project",
      supabaseProviderToolsAvailable: true,
      neonProjectId: "neon-project",
      neonActiveBranchId: "neon-branch",
    };

    const linkedNeonUnavailable = await estimateAgentToolTokens({
      ...baseOptions,
      neonProviderToolsAvailable: false,
    });
    const linkedNeonAvailable = await estimateAgentToolTokens({
      ...baseOptions,
      neonProviderToolsAvailable: true,
    });

    expect(linkedNeonAvailable).toBeGreaterThan(linkedNeonUnavailable);
  });
});

describe("discovery versus invocation availability", () => {
  it("exposes image generation only with a configured Seltra Engine URL and key", () => {
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === "generate_image")!;
    const ctx = { isDyadPro: false } as import("./tools/types").AgentContext;
    const oldUrl = process.env.SELTRA_ENGINE_URL;
    const oldKey = process.env.SELTRA_ENGINE_API_KEY;
    delete process.env.SELTRA_ENGINE_URL;
    delete process.env.SELTRA_ENGINE_API_KEY;
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(false);
    process.env.SELTRA_ENGINE_URL = "http://localhost:3001/v1";
    process.env.SELTRA_ENGINE_API_KEY = "sk_seltra_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(true);
    if (oldUrl === undefined) delete process.env.SELTRA_ENGINE_URL;
    else process.env.SELTRA_ENGINE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SELTRA_ENGINE_API_KEY;
    else process.env.SELTRA_ENGINE_API_KEY = oldKey;
  });

  it("exposes image generation and repair in Build mode with a configured engine, including free-model mode", () => {
    const imageTool = TOOL_DEFINITIONS.find((entry) => entry.name === "generate_image")!;
    const repairTool = TOOL_DEFINITIONS.find((entry) => entry.name === "repair_app")!;
    const ctx = { isDyadPro: false, freeModelMode: true } as import("./tools/types").AgentContext;
    const oldUrl = process.env.SELTRA_ENGINE_URL;
    const oldKey = process.env.SELTRA_ENGINE_API_KEY;
    process.env.SELTRA_ENGINE_URL = "http://localhost:3001/v1";
    process.env.SELTRA_ENGINE_API_KEY = "sk_seltra_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

    expect(shouldIncludeTool(imageTool, ctx, { toolProfile: "build", freeModelMode: true })).toBe(true);
    expect(shouldIncludeTool(repairTool, ctx, { toolProfile: "build", freeModelMode: true })).toBe(true);

    if (oldUrl === undefined) delete process.env.SELTRA_ENGINE_URL;
    else process.env.SELTRA_ENGINE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SELTRA_ENGINE_API_KEY;
    else process.env.SELTRA_ENGINE_API_KEY = oldKey;
  });

  it("keeps operationally unavailable pre-commit calls invocable but enforces read-only boundaries", () => {
    const tool = TOOL_DEFINITIONS.find(
      (tool) => tool.name === "run_pre_commit",
    )!;
    const ctx = {
      preCommitHookAvailable: false,
      isDyadPro: true,
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(false);
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(true);
    expect(shouldIncludeTool(tool, ctx, { readOnly: true }, "invocation")).toBe(
      false,
    );
  });
  it("runs an already-offered pre-commit tool through the shared guard after discovery changes", async () => {
    const ctx = {
      appId: 987656,
      appPath: "/tmp/unused-pre-commit",
      chatId: 1,
      isDyadPro: false,
      preCommitHookAvailable: true,
      preCommitRunCount: 100,
      onXmlComplete: vi.fn(),
      onXmlStream: vi.fn(),
      requireConsent: vi.fn(async () => true),
      referencedApps: new Map(),
      abortSignal: new AbortController().signal,
    } as unknown as import("./tools/types").AgentContext;
    const tools = buildAgentToolSet(ctx, { enableAppBlueprint: false });
    expect(tools.run_pre_commit).toBeDefined();
    ctx.preCommitHookAvailable = false;
    const result = await tools.run_pre_commit.execute({});
    expect(JSON.stringify(result)).toContain("already run");
    expect(ctx.onXmlComplete).toHaveBeenCalled();
  });
  it("does not turn search routing preferences into authorization while retaining Pro checks", () => {
    const tool = TOOL_DEFINITIONS.find((tool) => tool.name === "code_search")!;
    const ctx = {
      canUseExplorerSubagent: true,
      isDyadPro: true,
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(false);
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(false);
    expect(
      shouldIncludeTool(tool, { ...ctx, isDyadPro: false }, {}, "invocation"),
    ).toBe(false);
  });
});

describe("shell tool registration", () => {
  it("excludes shell from Build, Ask, Plan, Free turns and children", async () => {
    const { shouldIncludeTool } = await import("./tool_definitions");
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === "run_shell")!;
    const ctx = {
      isDyadPro: true,
      inferenceSettings: { enableShellTool: true },
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(true);
    for (const options of [
      { toolProfile: "build" as const },
      { readOnly: true },
      { planModeOnly: true },
      { freeModelMode: true },
    ]) {
      expect(shouldIncludeTool(tool, ctx, options)).toBe(false);
    }
    expect(
      shouldIncludeTool(tool, {
        ...ctx,
        mutationActivityOwner: {
          appId: 1,
          chatId: 1,
          turnId: "turn",
          actorRunId: "child",
          persona: "implementer",
        },
      }),
    ).toBe(false);
  });
});

import { refreshShellReviewToolInventory } from "./tool_definitions";
it("refreshes reviewer availability from registration and invocation guards", () => {
  const ctx = {
    isDyadPro: true,
    preCommitHookAvailable: false,
    shellReviewContext: {
      tools: [
        { name: "run_pre_commit", description: "pre-commit", available: false },
        { name: "get_mcp_tool_schema", description: "schema", available: true },
      ],
      history: [],
    },
  } as unknown as import("./tools/types").AgentContext;
  // Already offered tools remain callable when only a discovery condition changes.
  const registered = {
    run_pre_commit: { description: "Run hook" },
    cloud_logs: { description: "Read cloud logs" },
  };
  refreshShellReviewToolInventory(ctx, registered);
  expect(
    ctx.shellReviewContext!.tools.find((t) => t.name === "run_pre_commit")
      ?.available,
  ).toBe(true);
  expect(
    ctx.shellReviewContext!.tools.find((t) => t.name === "get_mcp_tool_schema")
      ?.available,
  ).toBe(false);
  expect(
    ctx.shellReviewContext!.tools.find((t) => t.name === "cloud_logs"),
  ).toMatchObject({ available: true, description: "Read cloud logs" });
  // Current mode guards override an old registration snapshot.
  refreshShellReviewToolInventory(ctx, registered, { readOnly: true });
  expect(
    ctx.shellReviewContext!.tools.find((t) => t.name === "run_pre_commit")
      ?.available,
  ).toBe(false);
});
