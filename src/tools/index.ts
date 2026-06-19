import type { Tool } from "../types.js";
import { bashTool } from "./bash.js";
import {
  globTool,
  grepTool,
  readFileTool,
  writeFileTool,
  appendFileTool,
  editFileTool,
  deleteFileTool,
  downloadFileTool,
} from "./filesystem.js";
import { sshTool } from "./ssh.js";
import { gitTool } from "./git.js";
import { fetchTool } from "./fetch.js";

export function getDefaultTools(): Tool[] {
  return [
    bashTool,
    sshTool,
    gitTool,
    fetchTool,
    readFileTool,
    writeFileTool,
    appendFileTool,
    editFileTool,
    deleteFileTool,
    downloadFileTool,
    globTool,
    grepTool,
  ];
}

export { gitTool } from "./git.js";
export { fetchTool } from "./fetch.js";
export { bashTool } from "./bash.js";
export {
  readFileTool,
  writeFileTool,
  appendFileTool,
  editFileTool,
  deleteFileTool,
  downloadFileTool,
  globTool,
  grepTool,
} from "./filesystem.js";
export { sshTool } from "./ssh.js";
