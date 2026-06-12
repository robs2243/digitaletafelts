import { Card } from './Card';

/** Verwaltet die noch nicht platzierten Karten in der Seitenleiste. */
export class CardPool {
  private cards: Card[] = [];

  get all(): readonly Card[] {
    return this.cards;
  }

  get isEmpty(): boolean {
    return this.cards.length === 0;
  }

  add(card: Card): void {
    this.cards.push(card);
  }

  findById(id: string): Card | undefined {
    return this.cards.find((c) => c.id === id);
  }

  /** Entfernt die Karte und gibt sie zurück (z. B. beim Platzieren). */
  remove(id: string): Card | undefined {
    const card = this.findById(id);
    if (card) this.cards = this.cards.filter((c) => c.id !== id);
    return card;
  }

  replaceAll(cards: Card[]): void {
    this.cards = cards;
  }
}
