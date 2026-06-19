import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Theme } from "../theme.js";
import { filterItems, clampIndex, type SelectItem } from "./select.js";

/** Visible rows before the list windows around the selection. */
const MAX_ROWS = 8;

interface SelectModalProps {
  theme: Theme;
  title: string;
  items: SelectItem[];
  query: string;
  index: number;
  width: number;
  onQueryChange: (q: string) => void;
  onSubmit: (value: string) => void;
}

/** Centered floating picker (opencode-style): title · esc, a search field, and a highlighted list. */
export function SelectModal({ theme, title, items, query, index, width, onQueryChange, onSubmit }: SelectModalProps) {
  const boxWidth = Math.min(Math.max(44, Math.floor(width * 0.8)), Math.max(44, width - 2));
  const inner = boxWidth - 4;
  const filtered = filterItems(items, query);
  const sel = clampIndex(index, filtered.length);

  const start = Math.max(0, Math.min(sel - Math.floor(MAX_ROWS / 2), Math.max(0, filtered.length - MAX_ROWS)));
  const shown = filtered.slice(start, start + MAX_ROWS);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
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

      <Box marginY={1}>
        <Text color={theme.muted}>Search </Text>
        <TextInput
          value={query}
          onChange={onQueryChange}
          onSubmit={() => filtered[sel] && onSubmit(filtered[sel].value)}
          placeholder=""
        />
      </Box>

      {filtered.length === 0 ? (
        <Text color={theme.muted}>no matches</Text>
      ) : (
        shown.map((it, i) => {
          const actual = start + i;
          const isSel = actual === sel;
          const line = it.desc ? `${it.label}  ${it.desc}` : it.label;
          if (isSel) {
            const padded = line.length > inner ? line.slice(0, inner - 1) + "…" : line.padEnd(inner);
            return (
              <Text key={it.value} backgroundColor={theme.accent} color="black">
                {padded}
              </Text>
            );
          }
          return (
            <Box key={it.value}>
              <Text bold color={theme.assistant}>
                {it.label}
              </Text>
              {it.desc ? <Text color={theme.muted}>  {it.desc}</Text> : null}
            </Box>
          );
        })
      )}
      {filtered.length > MAX_ROWS ? (
        <Box marginTop={1}>
          <Text color={theme.muted}>
            {sel + 1}/{filtered.length}   ↑/↓ select · ↵ choose · esc cancel
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
