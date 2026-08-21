import { DeckForm } from './DeckForm';

export default function Home() {
  return (
    <main>
      <h1>Commander Deck Analyzer</h1>
      <p className="sub">
        Paste a decklist to resolve it against Scryfall, validate it against the Commander
        rules, and profile its curve, types, and colours.
      </p>
      <DeckForm />
    </main>
  );
}
