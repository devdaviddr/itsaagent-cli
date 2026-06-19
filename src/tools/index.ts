import type { Tool } from "../types.js";
import { bashTool } from "./bash.js";
import { globTool, grepTool, readFileTool, writeFileTool } from "./filesystem.js";
import { sshTool } from "./ssh.js";

export function getDefaultTools(): Tool[] {
  return [bashTool, sshTool, readFileTool, writeFileTool, globTool, grepTool];
}

export { bashTool } from "./bash.js";
export { readFileTool, writeFileTool, globTool, grepTool } from "./filesystem.js";
export { sshTool } from "./ssh.js";
