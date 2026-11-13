// VENDORED mirror of video/lib/ugcOneTakeRedo.ts ONE_TAKE_HOLD_CODES. The CLI package builds standalone (rootDir ".")
// and cannot import video/lib, so this is a copy; exodus/commands/__tests__/video-one-take-hold.test.ts keeps the two
// equal.

/**
 * The findings the One-take video step writes on a take it kept and held for its words. Such a take holds the run's
 * cut until a person keeps it as it is; it cannot be made again on its own (`retry-clip` is refused on its run).
 */
export const ONE_TAKE_HOLD_CODES: readonly string[] = [
  "one-take-words-missing",
  "one-take-number-word-missing",
  "one-take-kept-paid-take",
  "one-take-words-unchecked",
];
