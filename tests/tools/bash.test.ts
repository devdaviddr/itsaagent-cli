import { describe, expect, it } from "vitest";
import { bashTool } from "../../src/tools/bash.js";

describe("bashTool", () => {
  it("runs a simple command and returns stdout", async () => {
    const result = await bashTool.execute({ command: "echo hello" });
    expect(result.success).toBe(true);
    expect(result.data.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 1 and error on failure", async () => {
    const result = await bashTool.execute({ command: "exit 1" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("returns stderr in error field", async () => {
    const result = await bashTool.execute({ command: "ls /nonexistent_path_xyz" });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("coerces non-string command arg", async () => {
    const result = await bashTool.execute({ command: 123 });
    // Should run "123" as a command and fail, not throw
    expect(result).toHaveProperty("success");
  });

  it("returns stdout even on non-zero exit", async () => {
    const result = await bashTool.execute({ command: "echo output; exit 2" });
    expect(result.data.trim()).toBe("output");
    expect(result.exitCode).toBe(2);
  });
});
