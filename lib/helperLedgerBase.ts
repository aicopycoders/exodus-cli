// VENDORED mirror of video/lib/helperLedgerBase.ts. The CLI package builds
// standalone (rootDir ".") and cannot import video/lib, so this is a copy.
// The helper band starts here: picture rows the run page must never show as a
// scene card live at sceneIndex >= HELPER_LEDGER_BASE (#2147). Each producer
// owns a sub-range so its rows can't collide with another producer's:
//   [900000, 910000)  guest establishing renders (#809) + product cards (#808)
//     909000, 909001  the Reference node's set plate and product sheet (#2627)
//   [910000, 920000)  cast identity stills (cast-anchor.ts CAST_LEDGER_BASE)
//   [920000, 960000)  set gate room options (#2202)
//   [960000, …)       cast gate option renders (#2202)
export const HELPER_LEDGER_BASE = 900000;
export const SET_OPTION_LEDGER_BASE = 920000;
export const CAST_OPTION_LEDGER_BASE = 960000;
