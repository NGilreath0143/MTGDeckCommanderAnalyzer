'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { analyzeDeckAction, type AnalyzeState } from './actions';
import { DeckProfileView } from './DeckProfileView';

const EXAMPLE = `1 Atraxa, Praetors' Voice
1 Sol Ring
1 Arcane Signet
1 Cultivate`;

const initialState: AnalyzeState = { profile: null, error: null, text: '' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Analyzing…' : 'Analyze deck'}
    </button>
  );
}

export function DeckForm() {
  const [state, formAction] = useActionState(analyzeDeckAction, initialState);

  return (
    <>
      <form action={formAction}>
        <textarea
          name="decklist"
          defaultValue={state.text}
          placeholder={EXAMPLE}
          spellCheck={false}
          aria-label="Decklist"
        />
        <SubmitButton />
      </form>

      {state.error && <div className="error-box">{state.error}</div>}
      {state.profile && <DeckProfileView profile={state.profile} />}
    </>
  );
}
