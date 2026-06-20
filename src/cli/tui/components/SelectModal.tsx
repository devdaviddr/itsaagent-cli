import { Box, Text, TextInput } from "tuir";
import type { Theme } from "../theme.js";
import { filterItems, clampIndex, type SelectItem } from "./select.js";

export type ModalVariant = "select" | "info";

interface SelectModalProps {
  theme: Theme;
  title: string;
  items: SelectItem[];
  query: string;
  index: number;
  /** Inner content width (the tuir Modal owns the border + panel). */
  width: number;
  variant: ModalVariant;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchOnChange: any;
  onSubmit: (value: string) => void;
  onUpArrow: () => void;
  onDownArrow: () => void;
}

/**
 * Inner content of a floating dialog. `select` shows a search field + a
 * highlighted, choosable list; `info` is a read-only scrollable viewer.
 */
export function SelectModal({
  theme,
  title,
  items,
  query,
  index,
  width,
  variant,
  searchOnChange,
  onSubmit,
  onUpArrow,
  onDownArrow,
}: SelectModalProps) {
  const isInfo = variant === "info";
  const maxRows = isInfo ? 14 : 8;
  const inner = Math.max(10, width);

  const filtered = isInfo ? items : filterItems(items, query);

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
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold={theme.bold} color={theme.accent}>
          {title}
        </Text>
        <Text color={theme.muted}>esc</Text>
      </Box>

      {!isInfo ? (
        <Box marginY={1}>
          <Text color={theme.muted}>Search </Text>
          <TextInput
            onChange={searchOnChange}
            autoEnter
            exitKeymap={{ key: "return" }}
            onExit={() => filtered[sel] && onSubmit(filtered[sel].value)}
            onUpArrow={onUpArrow}
            onDownArrow={onDownArrow}
            cursorColor={theme.accent}
            textStyle={{ color: theme.assistant }}
          />
        </Box>
      ) : (
        <Box height={1} />
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
              <Text key={it.value} backgroundColor={theme.accent} color="black" bold={theme.bold}>
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
