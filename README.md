# nixpkg-trellis

Nix packaging for `@os-eco/trellis-cli` using Bun and `bun2nix`.

## Package

- Upstream source: `RogerNavelsaker/trellis`
- Upstream package: `@os-eco/trellis-cli`
- Pinned version: `0.1.0`
- Installed binary: `trellis`
- Shortform output: `tl`

## What This Repo Does

- Pins the Trellis source repo through Nix
- Keeps `bun.nix` in sync with the pinned source repo `bun.lock`
- Builds the upstream CLI as a Bun application with `bun2nix`
- Exposes the canonical binary name `trellis`

## Files

- `flake.nix`: flake entrypoint
- `nix/package.nix`: Nix derivation
- `nix/package-manifest.json`: pinned source metadata and binary naming
- `bun.lock`: copied from the pinned Trellis source repo for dependency generation
- `bun.nix`: generated Bun dependency graph used by Nix

## Notes

- The default `out` output installs `trellis`.
- The shortform `tl` is available as a separate Nix output.
- This repo is packaging-only. Trellis specs and workflows belong in consumer repos.
