import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Guard against a Base UI menu crash that takes the whole page down.
 *
 * DropdownMenuLabel renders Base UI's Menu.GroupLabel, which THROWS
 * "MenuGroupRootContext is missing" unless it sits inside a Menu.Group
 * (DropdownMenuGroup). It is not a styling nicety — an unwrapped label is an
 * unhandled render error, and the user sees "This page couldn't load".
 *
 * Shipped exactly that on the map's storm-severity menu, where a Fragment stood
 * in for the group. TypeScript can't catch it (the prop types are satisfied) and
 * it only fires when the menu is opened, so a static check is the cheap defence.
 */

const SRC = join(process.cwd(), 'src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** The primitive's own definition legitimately references GroupLabel. */
const DEFINITION = join(SRC, 'components', 'ui', 'dropdown-menu.tsx');

describe('DropdownMenuLabel usage', () => {
  const users = tsxFiles(SRC)
    .filter((f) => f !== DEFINITION)
    .map((f) => ({ file: f, text: readFileSync(f, 'utf8') }))
    .filter(({ text }) => /<DropdownMenuLabel[\s>]/.test(text));

  it('is only used in files that also use DropdownMenuGroup', () => {
    const offenders = users
      .filter(({ text }) => !/<DropdownMenuGroup[\s>]/.test(text))
      .map(({ file }) => file.replace(process.cwd() + '/', ''));
    expect(offenders).toEqual([]);
  });

  // Catches the specific mistake that shipped: the label's nearest wrapper being
  // a Fragment rather than a group.
  it('never has a Fragment as the element immediately wrapping it', () => {
    const offenders: string[] = [];
    for (const { file, text } of users) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!/<DropdownMenuLabel[\s>]/.test(line)) return;
        // Walk back to the previous non-blank line; a Fragment there means the
        // label has no group around it.
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const prev = lines[j].trim();
          if (!prev || prev.startsWith('//') || prev.startsWith('*') || prev.startsWith('{/*')) continue;
          if (prev === '<>' || prev.endsWith('<>')) {
            offenders.push(`${file.replace(process.cwd() + '/', '')}:${i + 1}`);
          }
          break;
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
