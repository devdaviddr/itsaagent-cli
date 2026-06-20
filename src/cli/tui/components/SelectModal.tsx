import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Theme } from "../theme.js";
import { filterItems, clampIndex, type SelectItem } from "./select.js";

export type ModalVariant = "select" | "info";

interface SelectModalProps {
  theme: Theme;
  title: string;
  items: SelectItem[];
  query: string;
  index: number;
  width: number;
  variant?: ModalVariant;
  onQueryChange: (q: string) => void;
  onSubmit: (value: string) => void;
}

/**
 * Centered floating dialog (opencode-style). `select` shows a search field and a
 * highlighted, choosable list; `info` is a read-only scrollable viewer (help,
 * tools, about). Width accounts for the round border (2 cols) + paddingX 2 (4
 * cols) so the highlight bar never overflows and wraps.
 */
export function SelectModal({
  theme,
  title,
  items,
  query,
  index,
  width,
  variant = "select",
  onQueryChange,
  onSubmit,
}: SelectModalProps) {
  const isInfo = variant === "info";
  const maxRows = isInfo ? 14 : 8;
  const boxWidth = Math.min(
    Math.max(50, Math.floor(width * (isInfo ? 0.9 : 0.7))),
    Math.max(50, width - 2),
  );
  const inner = boxWidth - 6; // round border (2) + paddingX 2 (4)

  const filtered = isInfo ? items : filterItems(items, query);

  // select: cursor centered in the window. info: index is the scroll-top.
  let start: number;
  let sel: number;
  if (isInfo) {
    start = Math.max(0, Math.min(index, Math.max(0, filtered.length - maxRows)));
    sel = -1;
  } else {
    sel = clampIndex(index, filtered.length);
    start = Math.max(0, Math.min(sel - Math.floor(maxRows / 2), Math.max(0, filtered.length - maxRows)));
  }
  const shown = filtered.slice(start, start + maxRows);

  const truncate = (s: string): string => (s.length > inner ? s.slice(0, inner - 1) + "…" : s);

  const hint = isInfo ? "↑/↓ scroll · esc close" : "↑/↓ select · ↵ choose · esc cancel";
  const showCounter = filtered.length > maxRows;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={2}
      paddingY={1}
      width={boxWidth}
    >
      <Box justifyContent="space-between">
        <Text bold color={theme.accent}>
          {title}
        </Text>
        <Text color={theme.muted}>esc</Text>
      </Box>

      {!isInfo ? (
        <Box marginY={1}>
          <Text color={theme.muted}>Search </Text>
          <TextInput
            value={query}
            onChange={onQueryChange}
            onSubmit={() => filtered[sel] && onSubmit(filtered[sel].value)}
            placeholder="filter…"
          />
        </Box>
      ) : (
        <Box marginBottom={1} />
      )}

      {filtered.length === 0 ? (
        <Text color={theme.muted}>no results</Text>
      ) : isInfo ? (
        shown.map((it, i) => (
          <Text key={i} color={theme.muted}>
            {truncate(it.label.length > 0 ? it.label : " ")}
          </Text>
        ))
      ) : (
        shown.map((it, i) => {
          const actual = start + i;
          const isSel = actual === sel;
          const desc = it.desc ? `  ${it.desc}` : "";
          if (isSel) {
            const line = truncate(`${it.label}${desc}`);
            return (
              <Text key={it.value} backgroundColor={theme.accent} color="black" bold>
                {line.padEnd(inner)}
              </Text>
            );
          }
          const room = Math.max(0, inner - it.label.length);
          return (
            <Box key={it.value}>
              <Text color={theme.assistant}>{truncate(it.label)}</Text>
              {desc && room > 1 ? <Text color={theme.muted}>{desc.slice(0, room)}</Text> : null}
            </Box>
          );
        })
      )}

      <Box marginTop={1}>
        <Text color={theme.muted}>
          {showCounter ? `${isInfo ? start + 1 : sel + 1}/${filtered.length}   ` : ""}
          {hint}
        </Text>
      </Box>
    </Box>
  );
}
