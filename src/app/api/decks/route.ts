import { NextResponse } from 'next/server';
import { z } from 'zod';
import { importDeck } from '@/pipeline/importDeck';
import { ScryfallError } from '@/infra/scryfall/client';

/**
 * POST /api/decks — profile a decklist.
 *
 * An invalid deck is NOT an HTTP error: the profile comes back with 200 and a
 * populated `validation` block, so callers see the stats alongside the
 * problems. Only a malformed request or an upstream failure is an error.
 */

const bodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  name: z.string().nullish(),
  persist: z.boolean().optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { profile, stats } = await importDeck({
      text: parsed.data.text,
      name: parsed.data.name ?? null,
      persist: parsed.data.persist,
    });
    return NextResponse.json({ profile, stats });
  } catch (error) {
    if (error instanceof ScryfallError) {
      return NextResponse.json(
        { error: `Card lookup failed: ${error.message}` },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 500 });
  }
}
