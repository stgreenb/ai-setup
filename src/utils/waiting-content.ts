import chalk from 'chalk';
import cardsData from './waiting-cards.json';

const ACCENT = chalk.hex('#83D1EB');
const BRAND = chalk.hex('#EB9D83');

export interface WaitingCard {
  title: string;
  icon: string;
  lines: string[];
}

export const WAITING_CARDS: WaitingCard[] = cardsData as WaitingCard[];

function highlightCommands(text: string): string {
  return text.replace(/`([^`]+)`/g, (_, cmd: string) => ACCENT(cmd));
}

export function renderCard(
  card: WaitingCard,
  index: number,
  total: number,
  cols: number,
): string[] {
  const prefix = '    ';
  const maxWidth = Math.min(cols - 8, 65);

  const lines: string[] = [];

  lines.push(chalk.dim(`${prefix}${'─'.repeat(maxWidth)}`));
  lines.push('');

  const dots = Array.from({ length: total }, (_, i) =>
    i === index ? ACCENT('●') : chalk.dim('○'),
  ).join(' ');
  lines.push(`${prefix}${chalk.dim('While you wait...')}  ${dots}`);
  lines.push('');

  lines.push(`${prefix}${BRAND(card.icon)}  ${chalk.bold(card.title)}`);

  for (const line of card.lines) {
    lines.push(`${prefix}   ${chalk.dim(highlightCommands(line))}`);
  }

  lines.push('');
  lines.push(`${prefix}${chalk.dim('\u2190 \u2192  navigate     auto-advances every 15s')}`);

  return lines;
}
