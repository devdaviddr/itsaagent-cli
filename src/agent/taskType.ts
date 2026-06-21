const CODE_FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|rb|php|cs|cpp|c|h|sh|sql)\b/i;
const CODE_TOOLS = /\b(npm|pnpm|yarn|pip|cargo|gem|maven|gradle|docker|webpack|vite|babel|eslint|tsc)\b/i;
const CODE_SYNTAX = /\b(function|class|interface|async|await|import|export|const|let|var|def|fn|struct|trait|impl|enum)\b/;
const CODE_ACTIONS = /\b(implement|refactor|debug|compile|scaffold|lint|typecheck|parse|serialize|deserialize)\b/i;
const CODE_CONCEPTS = /\b(api|endpoint|database|schema|migration|server|client|middleware|route|handler|repository|controller|component|hook)\b/i;

export type TaskType = 'code' | 'general';

export function detectTaskType(task: string): TaskType {
  if (CODE_FILE_EXT.test(task)) return 'code';
  if (CODE_TOOLS.test(task)) return 'code';
  if (CODE_SYNTAX.test(task)) return 'code';
  if (CODE_ACTIONS.test(task)) return 'code';
  if (CODE_CONCEPTS.test(task)) return 'code';
  return 'general';
}
