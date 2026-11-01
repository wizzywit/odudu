# Third-party notices

Material that Odudu ships and that other people wrote. The full licence text
of each item is in [`LICENSES/`](LICENSES/), and the documentation site
publishes the font licences beside the fonts at `/licenses/`.

## Fonts

The admin console, the server's pages and the documentation site serve
IBM Plex Sans and IBM Plex Mono as web fonts, from the `@fontsource` packages
(version 5.3.0, pinned in `apps/admin-console`, `apps/docs` and
`packages/instrument`). Both are licensed under the SIL Open Font License,
Version 1.1.

| Family        | Copyright                | Licence text                                                               |
| ------------- | ------------------------ | -------------------------------------------------------------------------- |
| IBM Plex Sans | Copyright 2019 IBM Corp. | [`LICENSES/OFL-1.1-IBM-Plex-Sans.txt`](LICENSES/OFL-1.1-IBM-Plex-Sans.txt) |
| IBM Plex Mono | Copyright 2017 IBM Corp. | [`LICENSES/OFL-1.1-IBM-Plex-Mono.txt`](LICENSES/OFL-1.1-IBM-Plex-Mono.txt) |

The wordmark in `brand/` is IBM Plex Mono converted to outlines; its licence
text is `brand/LICENSE-IBM-Plex-Mono.txt`.

## Common-password list

A password is refused when it is on a list of common ones, which the server
holds in memory. The list is the entries of eight characters or more among the
first 100,000 lines of `xato-net-10-million-passwords-100000.txt` in
[SecLists](https://github.com/danielmiessler/SecLists), commit
`4c0fd59432ab8508edc23b3c880127edb12e34d5`, lowercased and without duplicates, less five entries (three that a
repository-wide word check refuses, two that hold a backtick, a backslash or a
dollar sign): 38,446 entries, in `packages/domain-identity/src/service/common-passwords-data.ts`.
SecLists is licensed under the MIT licence, Copyright (c) 2018 Daniel Miessler;
the licence text is [`LICENSES/MIT-SecLists.txt`](LICENSES/MIT-SecLists.txt).

## Image decoding

The server decodes and re-encodes every uploaded theme image with
[sharp](https://sharp.pixelplumbing.com/) 0.35.5 (Apache-2.0, Copyright 2013
Lovell Fuller and others; text in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)),
pinned in `packages/domain-theme`. sharp loads a prebuilt libvips from a
separate npm package per platform, `@img/sharp-libvips-*` 1.3.4, built by the
[sharp-libvips](https://github.com/lovell/sharp-libvips) project. The runtime
image carries the `linuxmusl` package for its CPU.

**libvips 8.18.7 is licensed under the GNU Lesser General Public License,
version 3 or later (`LGPL-3.0-or-later`), and so are the other LGPL libraries
in the same build.** The packages are loaded at run time as shared libraries
and are not modified. The licence texts are
[`LICENSES/LGPL-3.0-or-later.txt`](LICENSES/LGPL-3.0-or-later.txt) and, because
the LGPL is written as additional permissions on it,
[`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt). Odudu's own
code stays under AGPL-3.0-only. The runtime image carries this file and
`LICENSES/` in `/usr/share/licenses/odudu/`.

**Source.** libvips 8.18.7:
<https://github.com/libvips/libvips/releases/tag/v8.18.7>. The build of it and of
every library below, with its patches and build scripts, is sharp-libvips
1.3.4: <https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4>.

**Replacing it.** The library is a package, not part of Odudu's code. To run
with another build, point the `@img/sharp-libvips-<platform>` entry of the
lockfile at a package built from that source with a pnpm `overrides` entry and
reinstall, or build sharp against a system libvips. `SHARP_FORCE_GLOBAL_LIBVIPS`
is read only when sharp is built from source (`pnpm rebuild sharp`, in
`dist/libvips.cjs`), not when it loads at run time, so setting it on a running
server changes nothing. Nothing in Odudu depends on which build loads.

The LGPL packages in the lockfile are: `@img/sharp-libvips-darwin-arm64`,
`@img/sharp-libvips-darwin-x64`, `@img/sharp-libvips-linux-arm`,
`@img/sharp-libvips-linux-arm64`, `@img/sharp-libvips-linux-ppc64`,
`@img/sharp-libvips-linux-riscv64`, `@img/sharp-libvips-linux-s390x`,
`@img/sharp-libvips-linux-x64`, `@img/sharp-libvips-linuxmusl-arm64` and
`@img/sharp-libvips-linuxmusl-x64`, and the three Windows and WebAssembly
packages that carry libvips inside them (`Apache-2.0 AND LGPL-3.0-or-later`):
`@img/sharp-win32-arm64`, `@img/sharp-win32-ia32`, `@img/sharp-win32-x64` and
`@img/sharp-wasm32`. Only the `linuxmusl` package for the image's CPU is
installed in the image. The other `@img` packages are Apache-2.0
(`@img/sharp-linux-*`, `@img/sharp-linuxmusl-*`, `@img/sharp-darwin-*`,
`@img/sharp-freebsd-wasm32`, `@img/sharp-webcontainers-wasm32`) or MIT
(`@img/colour`).

The libraries in the libvips build, with the versions in the package's
`versions.json` and the licences its README gives. Only the metadata of the
installed `@img/sharp-libvips-darwin-arm64` 1.3.4 was read (all 28 versions
agree with the table). Every platform package is built from the same
sharp-libvips 1.3.4 release, but their component lists were not compared; the
`linuxmusl` package lands in the container build, which is where it is
installed:

| Library       | Version | Licence                                         |
| ------------- | ------- | ----------------------------------------------- |
| libvips       | 8.18.7  | LGPL-3.0-or-later                               |
| glib          | 2.90.0  | LGPL-3.0-or-later                               |
| pango         | 1.58.2  | LGPL-3.0-or-later                               |
| fribidi       | 1.0.17  | LGPL-3.0-or-later                               |
| libexif       | 0.6.26  | LGPL-3.0-or-later                               |
| libheif       | 1.23.5  | LGPL-3.0-or-later                               |
| librsvg       | 2.63.2  | LGPL-3.0-or-later                               |
| proxy-libintl | 0.5     | LGPL-3.0-or-later                               |
| cairo         | 1.18.6  | MPL-1.1                                         |
| aom           | 3.15.1  | BSD-2-Clause and the AOMedia Patent License 1.0 |
| cgif          | 0.5.4   | MIT                                             |
| expat         | 2.8.5   | MIT                                             |
| fontconfig    | 2.18.3  | fontconfig licence (BSD-like)                   |
| freetype      | 2.14.3  | FreeType licence (BSD-like)                     |
| harfbuzz      | 14.5.0  | MIT                                             |
| highway       | 1.4.0   | BSD-3-Clause                                    |
| lcms          | 2.19.1  | MIT                                             |
| libarchive    | 3.8.9   | BSD-2-Clause                                    |
| libffi        | 3.8.0   | MIT                                             |
| libimagequant | 2.4.1   | BSD-2-Clause                                    |
| libnsgif      | n/a     | MIT                                             |
| libpng        | 1.6.58  | libpng licence                                  |
| libtiff       | 4.7.2   | libtiff licence (BSD-like)                      |
| libultrahdr   | 2.0.2   | MIT                                             |
| libwebp       | 1.6.0   | BSD-3-Clause                                    |
| libxml2       | 2.15.4  | MIT                                             |
| mozjpeg       | 0826579 | zlib licence, IJG licence and BSD-3-Clause      |
| pixman        | 0.46.4  | MIT                                             |
| zlib-ng       | 2.3.3   | zlib licence                                    |

The LGPL versions are "version 3 or later" through the "any later version"
clause of the LGPL 2 and 2.1 that the upstream projects carry, as the package's
README says.
