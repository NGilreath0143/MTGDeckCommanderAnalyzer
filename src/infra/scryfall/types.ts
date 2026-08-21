/** The subset of the Scryfall card object this app relies on. */
export interface ScryfallCardFace {
  name?: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
}

export interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  mana_cost?: string;
  /** Present at the top level even for modal DFCs, whose faces omit it. */
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  color_identity?: string[];
  colors?: string[];
  layout?: string;
  keywords?: string[];
  legalities?: Record<string, string>;
  card_faces?: ScryfallCardFace[];
  [key: string]: unknown;
}

/** Identifier objects accepted by POST /cards/collection. */
export interface ScryfallIdentifier {
  name: string;
}

export interface ScryfallCollectionResponse {
  object: string;
  data: ScryfallCard[];
  /** Echoes back the identifier objects that matched nothing. */
  not_found: ScryfallIdentifier[];
}
