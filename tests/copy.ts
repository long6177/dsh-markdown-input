/**
 * Shared test helper: the plugin's own English dictionary, exported as a
 * plain indexable record. The source dictionary is `as const` with literal
 * keys, so tests that need to look a key up by a runtime string (the card's
 * dynamic key ladder, alternate-locale rows) read it through this widening
 * instead of re-declaring the copy.
 */
import { en } from '../src/client/locales.ts'

/** The `markdown-input` English dictionary as a widenable record. */
export const MARKDOWN_INPUT_EN: Record<string, string> = en
