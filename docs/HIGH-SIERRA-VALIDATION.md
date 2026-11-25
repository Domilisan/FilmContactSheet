# High Sierra compatibility validation — 2026-11-25

Scope: `compat/high-sierra`, based on `66cbce3`. Target: macOS 10.13.6, Intel iMac 2011, 8GB RAM.

## Passed locally on Windows x64

- TypeScript typecheck and production build targeting Node 18 / Chromium 116.
- 89 tests across 7 files: layout, templates, 16-bit TIFF, original-file preservation, JPEG size and ICC, all 8 EXIF orientations combined with 4 manual quarter-turns, serial task capacity and cancellation.
- Real Electron 26 desktop smoke: 36/38-photo import, approximately 80 MiB TIFF, template editing, undo, save/reopen, original-source export.
- Workspace smoke: per-project state/history/save paths, renaming and close protection.
- Multitask smoke: one image worker, queueing, cancellation, temporary-file cleanup, worker failure, project snapshots and continued editing.
- Scan-type smoke: all 11 templates, TIFF imports, tab switching, save/reopen and whole-strip export.
- Export-name smoke: custom/default filenames, invalid-name handling, overwrite cancellation, original-source protection.
- High Sierra runtime smoke: Electron 26.6.10 / Node 18.16.1 / Chromium 116.0.5845.228 / Sharp 0.32.6 / libvips 8.14.5; native File.path drop; 8000px default; renderer has no Node require.
- Packaged Windows app smoke: ASAR-native loading, icon, 16-bit TIFF import, save/reopen, 6000px JPEG with ICC and density, original unchanged. This is packaging evidence for Windows only.
- Inspected the generated Electron 26 workspace screenshot.

## Intel Mac native binaries inspected on Windows

Official Sharp libvips download passed its upstream integrity check. Both binaries have an x86_64 Mach-O header and a macOS deployment target of 10.13.0:

| File | SHA256 |
| --- | --- |
| sharp-darwin-x64.node | `03cab47e546990a5c0a92057217a36571e50293cd5e4016067dc22f16f5842fb` |
| libvips-cpp.42.dylib | `c032f7ec7dd271d16af098e69d2723f1227b14986fa50890c521b64f43dbc2ec` |

Reproduce with `npm run verify:mac:native` after installing the Mac native dependencies. This check does not run either binary on macOS.

## Not yet verified

- Mac app/DMG build, full bundled Mach-O inspection, ad-hoc signature and Mac packaged-app smoke.
- Startup, fonts, GPU, real scanner TIFF colour results, peak memory and speed on the target High Sierra iMac.
- Round-trip interoperability with existing real project files; use copies during testing.

The installed electron-builder 26.18.0 explicitly rejected a Mac build on Windows. No DMG was produced. Use `bash build-high-sierra.command` on a suitable Intel Mac with Node.js 24; do not run Node.js 24 on the High Sierra target.

Electron 26 is end-of-support. The runtime-only npm audit reports one high-severity affected package (Sharp, multiple native-library advisories); compatibility does not resolve these findings. The source kit is a test build input, not a supported/security-maintained release.

No push, remote workflow, release or publication was performed. The original main worktree remained at `66cbce3` and clean.
