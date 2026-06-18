import { describe, expect, it } from "vitest";
import type { RuntimeOptions } from "../../api";
import {
  buildProjectMenuOptions,
  buildPermissionMenuOptions,
  buildPermissionSendOptions,
} from "./Composer";

function runtimeOptions(
  overrides: Partial<RuntimeOptions> = {},
): RuntimeOptions {
  return {
    models: [],
    collaborationModes: [],
    permissionProfiles: [],
    defaults: {
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      collaborationModeName: "Default",
      permissionProfile: null,
    },
    source: {
      models: "fallback",
      collaborationModes: "fallback",
      permissionProfiles: "fallback",
    },
    warnings: [],
    ...overrides,
  };
}

describe("Composer permission options", () => {
  it("does not fall back to legacy full access when official profiles are constrained to empty", () => {
    const options = buildPermissionMenuOptions(
      runtimeOptions({
        permissionProfiles: [],
        source: {
          models: "fallback",
          collaborationModes: "fallback",
          permissionProfiles: "app-server",
        },
      }),
    );

    expect(options.map((option) => option.id)).toEqual(["legacy:default"]);
    expect(options[0]?.mode).toBeUndefined();
  });

  it("uses legacy options only when permission profiles are truly fallback", () => {
    const options = buildPermissionMenuOptions(runtimeOptions());

    expect(options.map((option) => option.id)).toContain("legacy:full-access");
  });

  it("prepends the default option to official permission profiles", () => {
    const options = buildPermissionMenuOptions(
      runtimeOptions({
        permissionProfiles: [
          {
            id: ":read-only",
            label: "Read Only",
            description: null,
            isBuiltin: true,
          },
        ],
        source: {
          models: "fallback",
          collaborationModes: "fallback",
          permissionProfiles: "app-server",
        },
      }),
    );

    expect(options.map((option) => option.id)).toEqual([
      "legacy:default",
      "profile::read-only",
    ]);
  });

  it("omits permission overrides while steering an active turn", () => {
    expect(
      buildPermissionSendOptions({
        activeSteerMode: true,
        selectedPermission: { profileId: ":danger-full-access" },
      }),
    ).toEqual({});
    expect(
      buildPermissionSendOptions({
        activeSteerMode: false,
        selectedPermission: { profileId: ":read-only" },
      }),
    ).toEqual({ permissionProfile: ":read-only" });
  });
});

describe("Composer project menu options", () => {
  it("keeps projectless as an explicit selectable option", () => {
    const options = buildProjectMenuOptions(
      [
        {
          id: "C:\\workspace\\project-a",
          name: "project-a",
          path: "C:\\workspace\\project-a",
          source: "official",
        },
      ],
      "C:\\workspace\\project-a",
    );

    expect(options.map((option) => option.path)).toEqual([
      null,
      "C:\\workspace\\project-a",
    ]);
    expect(options[0]).toMatchObject({
      label: "不使用项目",
      checked: false,
      noProject: true,
    });
  });

  it("allows selecting no project even when there are no project entries", () => {
    expect(buildProjectMenuOptions([], null)).toEqual([
      {
        id: "no-project",
        label: "不使用项目",
        path: null,
        checked: true,
        noProject: true,
      },
    ]);
  });
});
