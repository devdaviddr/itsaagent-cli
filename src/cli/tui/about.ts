/** About/credits text for the TUI `/about` command. Pure so it can be unit-tested. */
import { VERSION } from "../../version.js";

export const AUTHOR = "Daniel Ruffolo";
export const GITHUB_URL = "https://github.com/devdaviddr";
export const LICENCE = "MIT";

/** Multi-line about block: name + version, author, GitHub, and licence. */
export function aboutText(version: string = VERSION): string {
  return [
    `ItsAAgent v${version}`,
    "Local ReAct agent for the CLI, optimised for Ollama.",
    "",
    `Author   ${AUTHOR}`,
    `GitHub   ${GITHUB_URL}`,
    `Licence  ${LICENCE}`,
  ].join("\n");
}
