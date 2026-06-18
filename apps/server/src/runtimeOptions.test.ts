import { describe, expect, it } from "vitest";
import {
  normalizeCollaborationModeListResponse,
  normalizeModelListResponse,
  normalizePermissionProfileListResponse,
  normalizeRuntimeOptions,
} from "./runtimeOptions.js";

describe("runtime options normalization", () => {
  it("normalizes official model/list responses into public model options", () => {
    const models = normalizeModelListResponse({
      data: [
        {
          id: "model-a-id",
          model: "model-a",
          displayName: "Model A",
          description: "fast path",
          hidden: false,
          isDefault: true,
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
          inputModalities: ["text", "image"],
        },
        { id: "hidden-id", model: "hidden-model", hidden: true },
      ],
    });

    expect(models).toEqual([
      {
        id: "model-a-id",
        model: "model-a",
        displayName: "Model A",
        description: "fast path",
        isDefault: true,
        defaultReasoningEffort: "high",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "Medium" },
          { reasoningEffort: "high", description: "High" },
        ],
        inputModalities: ["text", "image"],
      },
    ]);
  });

  it("normalizes official collaboration modes and keeps plan settings", () => {
    const modes = normalizeCollaborationModeListResponse({
      data: [
        { name: "Default", mode: "default" },
        {
          name: "Plan",
          mode: "plan",
          model: "model-a",
          reasoning_effort: "medium",
          developer_instructions: "plan first",
        },
      ],
    });

    expect(modes).toEqual([
      {
        name: "Default",
        mode: "default",
        model: null,
        reasoningEffort: null,
        developerInstructions: null,
      },
      {
        name: "Plan",
        mode: "plan",
        model: "model-a",
        reasoningEffort: "medium",
        developerInstructions: "plan first",
      },
    ]);
  });

  it("falls back when official runtime option responses are empty", () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: { data: [] },
      collaborationModeListResponse: { data: [] },
      permissionProfileListResponse: { data: [] },
      warnings: ["model/list failed"],
    });

    expect(options.source).toEqual({
      models: "fallback",
      collaborationModes: "fallback",
      permissionProfiles: "fallback",
    });
    expect(options.models[0]?.model).toBe("gpt-5.5");
    expect(options.collaborationModes.map((mode) => mode.mode)).toEqual([
      "default",
      "plan",
    ]);
    expect(options.permissionProfiles).toEqual([]);
    expect(options.defaults).toMatchObject({
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      collaborationModeName: "Default",
      permissionProfile: null,
    });
    expect(options.warnings).toEqual(["model/list failed"]);
  });

  it("normalizes official permission profiles without guessing a default from the list", () => {
    const profiles = normalizePermissionProfileListResponse({
      data: [
        { id: ":read-only", description: null },
        { id: ":workspace", description: null },
        { id: ":danger-full-access", description: null },
        { id: "audit", description: "Inspect without writes." },
      ],
    });

    expect(profiles).toEqual([
      {
        id: ":read-only",
        label: "Read only",
        description: null,
        isBuiltin: true,
      },
      {
        id: ":workspace",
        label: "Workspace",
        description: null,
        isBuiltin: true,
      },
      {
        id: ":danger-full-access",
        label: "Full access",
        description: null,
        isBuiltin: true,
      },
      {
        id: "audit",
        label: "Inspect without writes.",
        description: "Inspect without writes.",
        isBuiltin: false,
      },
    ]);

    expect(
      normalizeRuntimeOptions({
        modelListResponse: { data: [] },
        collaborationModeListResponse: { data: [] },
        permissionProfileListResponse: { data: profiles },
      }).defaults.permissionProfile,
    ).toBeNull();
  });

  it("uses an explicit local Codex permission default when it is available", () => {
    expect(
      normalizeRuntimeOptions({
        modelListResponse: { data: [] },
        collaborationModeListResponse: { data: [] },
        permissionProfileListResponse: {
          data: [
            { id: ":read-only", description: null },
            { id: ":workspace", description: null },
            { id: ":danger-full-access", description: null },
          ],
        },
        localPermissionDefault: {
          permissionProfile: ":danger-full-access",
          source: "legacy-sandbox-config",
        },
      }).defaults.permissionProfile,
    ).toBe(":danger-full-access");
  });

  it("uses managed default_permissions before local Codex defaults", () => {
    expect(
      normalizeRuntimeOptions({
        modelListResponse: { data: [] },
        collaborationModeListResponse: { data: [] },
        permissionProfileListResponse: {
          data: [
            { id: ":read-only", description: null },
            { id: ":workspace", description: null },
          ],
        },
        configRequirementsResponse: {
          requirements: { default_permissions: ":read-only" },
        },
        localPermissionDefault: {
          permissionProfile: ":workspace",
          source: "legacy-sandbox-config",
        },
      }).defaults.permissionProfile,
    ).toBe(":read-only");
  });

  it("filters permission profiles through managed requirements allow-list", () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: { data: [] },
      collaborationModeListResponse: { data: [] },
      permissionProfileListResponse: {
        data: [
          { id: ":read-only", description: null },
          { id: ":workspace", description: null },
          { id: ":danger-full-access", description: null },
        ],
      },
      configRequirementsResponse: {
        requirements: {
          allowedPermissions: [":read-only", ":workspace"],
        },
      },
    });

    expect(options.permissionProfiles.map((profile) => profile.id)).toEqual([
      ":read-only",
      ":workspace",
    ]);
  });

  it("keeps permission profile source managed when the official allow-list is empty", () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: { data: [] },
      collaborationModeListResponse: { data: [] },
      permissionProfileListResponse: {
        data: [
          { id: ":read-only", description: null },
          { id: ":danger-full-access", description: null },
        ],
      },
      configRequirementsResponse: {
        requirements: {
          allowedPermissions: [],
        },
      },
    });

    expect(options.permissionProfiles).toEqual([]);
    expect(options.defaults.permissionProfile).toBeNull();
    expect(options.source.permissionProfiles).toBe("app-server");
  });

  it("uses the Desktop-aligned xhigh default when the official model supports it", () => {
    const options = normalizeRuntimeOptions({
      modelListResponse: {
        data: [
          {
            id: "model-a-id",
            model: "model-a",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
              { reasoningEffort: "xhigh", description: "Extra high" },
            ],
          },
        ],
      },
      collaborationModeListResponse: {
        data: [{ name: "Default", mode: "default" }],
      },
      permissionProfileListResponse: { data: [] },
    });

    expect(options.defaults).toMatchObject({
      model: "model-a",
      reasoningEffort: "xhigh",
      collaborationModeName: "Default",
    });
    expect(options.models[0]?.defaultReasoningEffort).toBe("medium");
  });
});
