import { describe, expect, it } from "vitest";
import {
  parseTopLevelTomlStrings,
  permissionDefaultFromConfigText,
  permissionDefaultFromRequirements,
  permissionProfileAllowListFromRequirements,
} from "./codexPermissionDefaults.js";

describe("Codex permission defaults", () => {
  it("reads only top-level TOML strings", () => {
    expect(
      parseTopLevelTomlStrings(`
        sandbox_mode = "workspace-write"
        [permissions.audit]
        default_permissions = ":danger-full-access"
      `),
    ).toEqual({ sandbox_mode: "workspace-write" });
  });

  it("prefers explicit default_permissions from user config", () => {
    expect(
      permissionDefaultFromConfigText(`
        default_permissions = "audit"
        sandbox_mode = "danger-full-access"
        approval_policy = "never"
      `),
    ).toEqual({ permissionProfile: "audit", source: "user-config" });
  });

  it("maps legacy sandbox defaults to built-in permission profiles", () => {
    expect(
      permissionDefaultFromConfigText(`
        sandbox_mode = "danger-full-access"
        approval_policy = "never"
      `),
    ).toEqual({
      permissionProfile: ":danger-full-access",
      source: "legacy-sandbox-config",
    });
    expect(
      permissionDefaultFromConfigText('sandbox_mode = "workspace-write"'),
    ).toEqual({
      permissionProfile: ":workspace",
      source: "legacy-sandbox-config",
    });
    expect(
      permissionDefaultFromConfigText('sandbox_mode = "read-only"'),
    ).toEqual({
      permissionProfile: ":read-only",
      source: "legacy-sandbox-config",
    });
  });

  it("uses managed default_permissions before managed allow-list fallback", () => {
    expect(
      permissionDefaultFromRequirements({
        requirements: {
          default_permissions: ":read-only",
          allowed_permission_profiles: {
            ":read-only": true,
            ":workspace": true,
          },
        },
      }),
    ).toEqual({
      permissionProfile: ":read-only",
      source: "managed-requirements",
    });
  });

  it("uses the official managed workspace fallback when both read-only and workspace are allowed", () => {
    expect(
      permissionDefaultFromRequirements({
        requirements: {
          allowed_permission_profiles: {
            ":read-only": true,
            ":workspace": true,
          },
        },
      }),
    ).toEqual({
      permissionProfile: ":workspace",
      source: "managed-requirements",
    });
  });

  it("reads managed permission allow-lists from official snake and camel forms", () => {
    expect(
      Array.from(
        permissionProfileAllowListFromRequirements({
          requirements: {
            allowed_permission_profiles: {
              ":read-only": true,
              ":workspace": true,
              ":danger-full-access": false,
            },
          },
        }) ?? [],
      ).sort(),
    ).toEqual([":read-only", ":workspace"]);

    expect(
      Array.from(
        permissionProfileAllowListFromRequirements({
          requirements: {
            allowedPermissions: [":read-only", ":workspace"],
          },
        }) ?? [],
      ).sort(),
    ).toEqual([":read-only", ":workspace"]);
  });
});
