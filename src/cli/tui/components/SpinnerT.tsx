import { Text } from "tuir";
import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Braille spinner for the tuir TUI (the Ink `Spinner` stays for the legacy one-shot view). */
export function SpinnerT({ color }: { color?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 120);
    return () => clearInterval(t);
  }, []);
  return <Text color={color ?? "cyan"}>{FRAMES[i]}</Text>;
}
