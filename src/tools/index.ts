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
import { sshTool, sshUploadTool, sshDownloadTool } from "./ssh.js";
import { gitTool } from "./git.js";
import { fetchTool } from "./fetch.js";
import { askUserTool } from "./ask.js";

export function getDefaultTools(): Tool[] {
  return [
    askUserTool,
    bashTool,
    sshTool,
    sshUploadTool,
    sshDownloadTool,
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
export { sshUploadTool, sshDownloadTool } from "./ssh.js";
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
export { askUserTool } from "./ask.js";
