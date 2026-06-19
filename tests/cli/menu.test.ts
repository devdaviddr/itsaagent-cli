import { describe, expect, it } from "vitest";
import { shouldShowMenu, applyProviderSettings } from "../../src/cli/menu.js";
import { defaultConfig } from "../../src/cli/config.js";

describe("shouldShowMenu", () => {
  it("shows the menu only with no args in a TTY", () => {
    expect(shouldShowMenu(["node", "iaa"], true)).toBe(true);
  });
  it("does not show the menu when not a TTY (piped)", () => {
    expect(shouldShowMenu(["node", "iaa"], false)).toBe(false);
  });
  it("does not show the menu when a subcommand is given", () => {
    expect(shouldShowMenu(["node", "iaa", "run", "task"], true)).toBe(false);
  });
});

describe("applyProviderSettings", () => {
  it("updates provided fields and keeps the rest", () => {
    const conf = defaultConfig();
    const updated = applyProviderSettings(conf, { host: "http://h:1", model: "m2" });
    expect(updated.host).toBe("http://h:1");
    expect(updated.model).toBe("m2");
    expect(updated.providerType).toBe(conf.providerType);
    expect(updated.maxSteps).toBe(conf.maxSteps);
  });

  it("keeps the existing apiKey when a blank one is supplied", () => {
    const conf = { ...defaultConfig(), apiKey: "secret" };
    const updated = applyProviderSettings(conf, { apiKey: "" });
    expect(updated.apiKey).toBe("secret");
  });

  it("sets a new apiKey when provided", () => {
    const updated = applyProviderSettings(defaultConfig(), { apiKey: "new-key" });
    expect(updated.apiKey).toBe("new-key");
  });
});
