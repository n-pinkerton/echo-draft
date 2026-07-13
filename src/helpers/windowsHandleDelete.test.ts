import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import windowsHandleDelete from "./windowsHandleDelete.js";

const { POWERSHELL_SCRIPT, deleteWindowsPathByHandle, getWindowsPathIdentity } =
  windowsHandleDelete as any;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("windowsHandleDelete", () => {
  it("opens both root and candidate without following reparse points and deletes by handle", () => {
    expect(POWERSHELL_SCRIPT).toContain("FILE_FLAG_OPEN_REPARSE_POINT");
    expect(POWERSHELL_SCRIPT).toContain("GetFinalPathNameByHandle");
    expect(POWERSHELL_SCRIPT).toContain("SetFileInformationByHandle");
  });

  it.runIf(process.platform === "win32")(
    "deletes the already-verified file object while preserving outside paths",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-handle-delete-"));
      const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-handle-outside-"));
      roots.push(root, outsideRoot);
      const target = path.join(root, "echodraft-debug-2026-07-13.jsonl");
      const outside = path.join(outsideRoot, "private.txt");
      fs.writeFileSync(target, "diagnostic");
      fs.writeFileSync(outside, "outside private data");

      await expect(deleteWindowsPathByHandle(root, target)).resolves.toMatchObject({
        success: true,
        deleted: true,
        bytes: Buffer.byteLength("diagnostic"),
      });
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readFileSync(outside, "utf8")).toBe("outside private data");
      await expect(deleteWindowsPathByHandle(root, outside)).rejects.toThrow(/outside/i);
      expect(fs.readFileSync(outside, "utf8")).toBe("outside private data");
    }
  );

  it.runIf(process.platform === "win32")(
    "refuses root and candidate pathname replacements after identities were retained",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-handle-root-swap-"));
      const movedRoot = `${root}-moved`;
      roots.push(root, movedRoot);
      const originalTarget = path.join(root, "echodraft-debug-2026-07-13.jsonl");
      fs.writeFileSync(originalTarget, "original");
      const rootIdentity = await getWindowsPathIdentity(root, { expectDirectory: true });
      const targetIdentity = await getWindowsPathIdentity(originalTarget);

      fs.renameSync(root, movedRoot);
      fs.mkdirSync(root);
      const replacementTarget = path.join(root, path.basename(originalTarget));
      fs.writeFileSync(replacementTarget, "replacement");

      await expect(
        deleteWindowsPathByHandle(root, replacementTarget, {
          expectedRootIdentity: rootIdentity,
          expectedTargetIdentity: targetIdentity,
        })
      ).resolves.toMatchObject({ success: false, deleted: false });
      expect(fs.readFileSync(replacementTarget, "utf8")).toBe("replacement");
      expect(fs.readFileSync(path.join(movedRoot, path.basename(originalTarget)), "utf8")).toBe(
        "original"
      );
    }
  );
});
