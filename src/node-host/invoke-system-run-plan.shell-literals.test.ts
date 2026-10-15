/** Literal shell arguments must prepare without weakening node approval bindings. */
import { describe, expect, it } from "vitest";
import { buildSystemRunApprovalPlan } from "./invoke-system-run-plan.js";
import {
  canMutateNativeBinaryFixturePath,
  resolveNativeBinaryFixturePath,
} from "./system-run-native-binary.test-helpers.js";

const DENIED_RUNTIME_APPROVAL = expect.objectContaining({
  ok: false,
  reason: "unsupported-command-shape",
});

describe("literal shell arguments in node approval plans", () => {
  it.skipIf(process.platform === "win32")(
    "preserves quoted and escaped literal arguments in native shell approval plans",
    () => {
      const binaryPath = resolveNativeBinaryFixturePath();
      if (canMutateNativeBinaryFixturePath(binaryPath)) {
        return;
      }
      const callback = "http://127.0.0.1:9876/oauth2/callback?state=synthetic&code=synthetic";
      for (const argument of [
        `'${callback}'`,
        `"${callback}"`,
        callback.replace("&", "\\&"),
        "'literal;pipe|redirect<>$value`text`'",
        '"literal;pipe|redirect<>"',
      ]) {
        const command = `${binaryPath} --auth-url ${argument}`;
        const prepared = buildSystemRunApprovalPlan({
          command: ["/bin/sh", "-lc", command],
          rawCommand: command,
          cwd: process.cwd(),
        });
        expect(prepared.ok, command).toBe(true);
        if (!prepared.ok) {
          throw new Error("expected a literal command approval plan");
        }
        expect(prepared.plan.argv).toEqual(["/bin/sh", "-lc", command]);
        expect(prepared.plan.mutableFileOperand).toBeUndefined();
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps shell control, expansions and malformed payloads out of native approval plans",
    () => {
      const binaryPath = resolveNativeBinaryFixturePath();
      for (const argument of [
        "safe&other",
        "safe;other",
        "safe|other",
        "safe>out",
        "safe<in",
        "safe\nother",
        "safe # comment\nother",
        "safe\u000b#; other",
        "safe\u00a0#; other",
        "''#; other",
        '""#; other',
        "''#$(other)",
        '""#`other`',
        '"$(other)&literal"',
        '"`other`&literal"',
        '"${VALUE}&literal"',
        "'unterminated",
        "trailing\\",
      ]) {
        const command = `${binaryPath} ${argument}`;
        expect(
          buildSystemRunApprovalPlan({
            command: ["/bin/sh", "-lc", command],
            rawCommand: command,
            cwd: process.cwd(),
          }),
          command,
        ).toEqual(DENIED_RUNTIME_APPROVAL);
      }
    },
  );
});
