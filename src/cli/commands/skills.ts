import chalk from "chalk";
import type { Command } from "commander";
import { loadSkills, SKILLS_DIR } from "../../agent/SkillLoader.js";

export function registerSkillsCommand(program: Command): void {
  program
    .command("skills")
    .description("List installed skills")
    .action(async () => {
      const skills = await loadSkills();
      if (skills.length === 0) {
        console.log(`No skills installed. Add markdown files to ${SKILLS_DIR}`);
        return;
      }
      console.log(chalk.bold("\nInstalled skills:\n"));
      for (const s of skills) {
        const args = s.args.length > 0 ? chalk.dim(`  args: ${s.args.map((a) => a.name + (a.required ? "*" : "")).join(", ")}`) : "";
        console.log(`  ${chalk.cyan(s.name.padEnd(16))} ${s.description}`);
        if (args) console.log(`  ${" ".repeat(16)}${args}`);
      }
      console.log();
    });
}
