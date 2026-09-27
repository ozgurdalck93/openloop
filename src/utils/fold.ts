/**
 * Text folding shared by the parser and the engine: lowercase ASCII with Turkish
 * diacritics stripped, LENGTH-PRESERVING (one output unit per input unit) so an
 * index in the folded text is also an index in the original.
 */
const FOLD_MAP: Record<string, string> = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
  '’': "'", '‘': "'", '`': "'", '´': "'", '“': '"', '”': '"', '…': '.', '–': '-', '—': '-', ' ': ' ',
};

export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const mapped = FOLD_MAP[text[i]] ?? text[i];
    const lower = mapped.toLowerCase();
    out += lower.length === 1 ? lower : mapped;
  }
  return out;
}
