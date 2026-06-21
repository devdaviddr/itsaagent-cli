import { Box, Text } from "tuir";
import { useEffect, useState } from "react";
import type { Theme } from "../theme.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// A short "pulse" bar that sweeps, so the response area reads as actively working.
const PULSE = ["▰▱▱▱▱", "▰▰▱▱▱", "▰▰▰▱▱", "▱▰▰▰▱", "▱▱▰▰▰", "▱▱▱▰▰", "▱▱▱▱▰", "▱▱▱▱▱"];

/**
 * Animated "generating response" indicator shown beneath the streaming output
 * while the model is producing a reply. Drives its own frame timer.
 */
export function GeneratingLoader({ theme }: { theme: Theme }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % 1000), 90);
    return () => clearInterval(t);
  }, []);
  const spin = SPIN[i % SPIN.length];
  const pulse = PULSE[i % PULSE.length];
  const dots = ".".repeat((Math.floor(i / 4) % 3) + 1);
  return (
    <Box>
      <Text color={theme.accent} bold={theme.bold}>{spin} </Text>
      <Text color={theme.thought}>Generating{dots}</Text>
      <Text color={theme.muted}>  {pulse}</Text>
    </Box>
  );
}
