import { describe, expect, it } from "vitest";
import { aboutText, AUTHOR, GITHUB_URL, LICENCE } from "../../../src/cli/tui/about.js";
import { parseChatInput, matchCommands } from "../../../src/cli/chatCommands.js";

describe("about text", () => {
  it("includes name + version, author, github, and licence", () => {
    const text = aboutText("1.2.3");
    expect(text).toContain("ItsAAgent v1.2.3");
    expect(text).toContain(AUTHOR);
    expect(text).toContain(GITHUB_URL);
    expect(text).toContain(LICENCE);
  });

  it("names Daniel Ruffolo and the correct GitHub", () => {
    expect(AUTHOR).toBe("Daniel Ruffolo");
    expect(GITHUB_URL).toBe("https://github.com/devdaviddr");
    expect(LICENCE).toBe("MIT");
  });
});

describe("/about command", () => {
  it("parses /about and its aliases", () => {
    expect(parseChatInput("/about")).toEqual({ kind: "about" });
    expect(parseChatInput("/version")).toEqual({ kind: "about" });
    expect(parseChatInput("/licence")).toEqual({ kind: "about" });
    expect(parseChatInput("/license")).toEqual({ kind: "about" });
  });

  it("appears in autocomplete for /ab", () => {
    expect(matchCommands("/ab").map((c) => c.name)).toEqual(["about"]);
  });
});
