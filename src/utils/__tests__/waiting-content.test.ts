import { describe, it, expect } from 'vitest';
import { WAITING_CARDS, renderCard } from '../waiting-content.js';

describe('WAITING_CARDS', () => {
  it('has at least 4 cards', () => {
    expect(WAITING_CARDS.length).toBeGreaterThanOrEqual(4);
  });

  it('each card has title, icon, and 2-5 body lines', () => {
    for (const card of WAITING_CARDS) {
      expect(card.title).toBeTruthy();
      expect(card.icon).toBeTruthy();
      expect(card.lines.length).toBeGreaterThanOrEqual(2);
      expect(card.lines.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('renderCard', () => {
  const cards = WAITING_CARDS;

  it('returns an array of strings', () => {
    const result = renderCard(cards[0], 0, cards.length, 80);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes the "While you wait" header', () => {
    const result = renderCard(cards[0], 0, cards.length, 80);
    const header = result.find(l => l.includes('While you wait'));
    expect(header).toBeDefined();
  });

  it('includes navigation hint', () => {
    const result = renderCard(cards[0], 0, cards.length, 80);
    const hint = result.find(l => l.includes('navigate'));
    expect(hint).toBeDefined();
  });

  it('renders all cards without errors', () => {
    for (let i = 0; i < cards.length; i++) {
      const result = renderCard(cards[i], i, cards.length, 80);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('handles narrow terminal width', () => {
    const result = renderCard(cards[0], 0, cards.length, 40);
    expect(result.length).toBeGreaterThan(0);
  });
});
