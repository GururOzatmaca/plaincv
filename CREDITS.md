# Credits

## Fonts

All faces in `public/fonts/` are bundled with the app and embedded into the PDFs it
produces. They are subset to latin + latin-ext by `scripts/build-fonts.mjs`; subsetting
does not change their licence terms.

### SIL Open Font License 1.1 (https://openfontlicense.org)

Every bundled face is under the OFL. The full licence text ships with the app at
[`public/licenses/OFL-1.1.txt`](public/licenses/OFL-1.1.txt) and is served at
`/licenses/OFL-1.1.txt`; OFL §2 requires each copy distributed with software to carry it.

Copyright lines below are read out of each font's own `name` table rather than
transcribed by hand, so they track what `npm run fonts` actually downloaded.

| Family | Files | Copyright |
| --- | --- | --- |
| Carlito | `Carlito-*` | © 2013 The Carlito Project Authors. Metric-compatible with Calibri. |
| Caladea | `Caladea-*` | © 2012 The Caladea Project Authors (Huerta Tipográfica). Metric-compatible with Cambria. |
| Gelasio | `Gelasio-*` | © 2022 The Gelasio Project Authors (Sorkin Type). Metric-compatible with Georgia. |
| Lato | `Lato-*` | © 2011-2015 tyPoland Łukasz Dziedzic. Reserved Font Name "Lato". |
| Inter | `Inter-*` | © 2016 The Inter Project Authors. |
| Source Sans 3 | `SourceSans3-*` | © 2023 Adobe. Reserved Font Name "Source". |
| Source Serif 4 | `SourceSerif4-*` | © 2014-2021 Adobe Systems Incorporated. Reserved Font Name "Source". |
| Open Sans | `OpenSans-*` | © 2020 The Open Sans Project Authors. |
| IBM Plex Sans | `IBMPlexSans-*` | © 2019 IBM Corp. |
| IBM Plex Serif | `IBMPlexSerif-*` | © 2020 IBM Corp. |
| EB Garamond | `EBGaramond-*` | © 2017 The EB Garamond Project Authors. |
| Merriweather | `Merriweather-*` | © 2024 The Merriweather Project Authors. Reserved Font Name "Merriweather". |
| Liberation Serif | `LiberationSerif-*` | Digitized data © 2010 Google Corporation; © 2012 Red Hat, Inc. Metric-compatible with Times New Roman. |
| Liberation Sans | `LiberationSans-*` | Digitized data © 2010 Google Corporation; © 2012 Red Hat, Inc. Metric-compatible with Arial. |

The Liberation faces are widely described as GPLv2-with-font-exception. That applied only
before 2.00.0 (July 2012). The bundled faces report `Version 2.1.5`, so they are OFL like
everything else here and no GPL text is distributed.

## Sound

- `public/sounds/chime.mp3` — "UI Chime Notification Sound" by SoundShelfStudio,
  via Pixabay (https://pixabay.com/sound-effects/technology-ui-chime-notification-sound-553111/).
  Licensed under the Pixabay Content License
  (https://pixabay.com/service/license-summary/).
  Used as an in-app UI sound. Not redistributed as a standalone file.
