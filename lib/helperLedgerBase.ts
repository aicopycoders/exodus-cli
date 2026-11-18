// VENDORED mirror of video/lib/helperLedgerBase.ts. The CLI package builds
// standalone (rootDir ".") and cannot import video/lib, so this is a copy.
// The helper band starts here: picture rows the run page must never show as a
// scene card live at sceneIndex >= HELPER_LEDGER_BASE (#2147). Each producer
// owns a sub-range so its rows can't collide with another producer's:
//   [900000, 910000)  guest establishing renders (#809) + product cards (#808)
//     909000, 909001  the Reference node's set plate and product sheet (#2627)
//     909100          the one-take storyboard node's picture of the place, drawn before its stop (COP-351)
//     909101          the one-take storyboard node's face photo, drawn before its stop (COP-380)
//     909102          the one-take storyboard node's product cut-out, drawn before its stop (COP-380)
//     909103-909105   the one-take storyboard node's checks of the face photo, the place and the cut-out (COP-380)
//     909106-909108   the one-take storyboard node's redraws of the face photo, the place and the cut-out after a
//                     failed check (COP-380)
//     909110          the one-take video node's take prompts said again with rows added at its stop (COP-387)
//     909120 + n      the one-take video node's check of take n's opening, take 1 only (COP-377)
//     909210 + n      the one-take video node's face boxes of take n, 1 to 6 (COP-383, the post-production band)
//     909220          the one-take storyboard node's music brief, one text call (COP-383, the post-production band)
//   [910000, 920000)  cast identity stills (cast-anchor.ts CAST_LEDGER_BASE)
//   [920000, 960000)  set gate room options (#2202)
//   [960000, …)       cast gate option renders (#2202)
export const HELPER_LEDGER_BASE = 900000;
export const SET_OPTION_LEDGER_BASE = 920000;
export const CAST_OPTION_LEDGER_BASE = 960000;

/** COP-351: the row on a One-take run's storyboard node of the picture of the place, drawn before the run stops there. */
export const ONE_TAKE_BOARD_PLACE_LEDGER_INDEX = HELPER_LEDGER_BASE + 9100;

/** COP-380: the rows on that node of the face photo and of the product cut-out, drawn before the run stops there. */
export const ONE_TAKE_BOARD_FACE_LEDGER_INDEX = HELPER_LEDGER_BASE + 9101;
export const ONE_TAKE_BOARD_CUTOUT_LEDGER_INDEX = HELPER_LEDGER_BASE + 9102;

/** COP-380: the rows on that node of the check of the face photo, the place and the cut-out, and how each ended. */
export const ONE_TAKE_BOARD_FACE_CHECK_LEDGER_INDEX = HELPER_LEDGER_BASE + 9103;
export const ONE_TAKE_BOARD_PLACE_CHECK_LEDGER_INDEX = HELPER_LEDGER_BASE + 9104;
export const ONE_TAKE_BOARD_CUTOUT_CHECK_LEDGER_INDEX = HELPER_LEDGER_BASE + 9105;

/** COP-380: the rows on that node of the one redraw of each picture whose check failed; the stop shows a redraw that came out. */
export const ONE_TAKE_BOARD_FACE_REDRAW_LEDGER_INDEX = HELPER_LEDGER_BASE + 9106;
export const ONE_TAKE_BOARD_PLACE_REDRAW_LEDGER_INDEX = HELPER_LEDGER_BASE + 9107;
export const ONE_TAKE_BOARD_CUTOUT_REDRAW_LEDGER_INDEX = HELPER_LEDGER_BASE + 9108;
