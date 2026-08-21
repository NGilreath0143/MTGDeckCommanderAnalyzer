'use server';

import { importDeck } from '@/pipeline/importDeck';
import { ScryfallError } from '@/infra/scryfall/client';
import type { DeckProfile } from '@/domain/types';

export interface AnalyzeState {
  profile: DeckProfile | null;
  error: string | null;
  /** Echoed back so the textarea keeps its content after a submit. */
  text: string;
}

/** Server action behind the page form. Calls the same pipeline as the API. */
export async function analyzeDeckAction(
  _prev: AnalyzeState,
  formData: FormData,
): Promise<AnalyzeState> {
  const text = String(formData.get('decklist') ?? '');
  if (!text.trim()) {
    return { profile: null, error: 'Paste a decklist first.', text };
  }

  try {
    const { profile } = await importDeck({ text });
    return { profile, error: null, text };
  } catch (error) {
    const message =
      error instanceof ScryfallError
        ? `Card lookup failed: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown error';
    return { profile: null, error: message, text };
  }
}
