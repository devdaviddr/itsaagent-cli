import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { sshUploadTool, sshDownloadTool } from "../../src/tools/ssh.js";
import { getDefaultTools } from "../../src/tools/index.js";

// Note: actual scp transfers require a live remote and are exercised manually.
// These cover the deterministic, offline-checkable behaviour.

describe("sshUploadTool", () => {
  it("errors before scp when the local file does not exist", async () => {
    const result = await sshUploadTool.execute({
      host: "192.0.2.1", // TEST-NET, never routable
      user: "nobody",
      local_path: join(tmpdir(), "definitely-missing-itsaagent.bin"),
      remote_path: "/tmp/x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Local file not found/);
  });

  it("declares the required parameters", () => {
    expect(sshUploadTool.definition.parameters.required).toEqual(["host", "user", "local_path", "remote_path"]);
  });
});

describe("sshDownloadTool", () => {
  it("declares the required parameters", () => {
    expect(sshDownloadTool.definition.parameters.required).toEqual(["host", "user", "remote_path", "local_path"]);
  });
});

describe("registration", () => {
  it("registers both transfer tools", () => {
    const names = getDefaultTools().map((t) => t.definition.name);
    expect(names).toContain("ssh_upload");
    expect(names).toContain("ssh_download");
  });
});
