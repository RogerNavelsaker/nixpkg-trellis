{ bash, bun, bun2nix, fetchFromGitHub, installShellFiles, lib, makeWrapper, symlinkJoin }:

let
  manifest = builtins.fromJSON (builtins.readFile ./package-manifest.json);
  packageVersion =
    manifest.package.version
    + lib.optionalString (manifest.package ? packageRevision) "-r${toString manifest.package.packageRevision}";
  licenseMap = {
    "MIT" = lib.licenses.mit;
    "Apache-2.0" = lib.licenses.asl20;
    "SEE LICENSE IN README.md" = lib.licenses.unfree;
  };
  resolvedLicense =
    if builtins.hasAttr manifest.meta.licenseSpdx licenseMap
    then licenseMap.${manifest.meta.licenseSpdx}
    else lib.licenses.unfree;
  aliasOutputs = manifest.binary.aliases or [ ];
  aliasOutputLinks = lib.concatMapStrings
    (
      alias:
      ''
        mkdir -p "${"$" + alias}/bin"
        cat > "${"$" + alias}/bin/${alias}" <<EOF
#!${lib.getExe bash}
exec "$out/bin/${manifest.binary.name}" "\$@"
EOF
        chmod +x "${"$" + alias}/bin/${alias}"
      ''
    )
    aliasOutputs;
  trellisSrc = fetchFromGitHub {
    owner = "RogerNavelsaker";
    repo = "trellis";
    rev = "5aaa0328b2c417ef63c35a58635f21f14bae4a96";
    hash = "sha256-XODTiDECoKTcJI9PupBQRuaBKjW8x2sy9FLpeZjMX7M=";
  };
  basePackage = bun2nix.writeBunApplication {
    pname = manifest.package.repo;
    version = packageVersion;
    packageJson = ../package.json;
    src = trellisSrc;
    dontUseBunBuild = true;
    dontUseBunCheck = true;
    postPatch = ''
      # Replace upstream packaging metadata with the synced local packaging view
      # so the Bun install phase only sees the dependencies encoded in bun.nix.
      cp ${../package.json} package.json
      cp ${../bun.lock} bun.lock
    '';
    startScript = ''
      bunx ${manifest.binary.upstreamName or manifest.binary.name} "$@"
    '';
    bunDeps = bun2nix.fetchBunDeps {
      bunNix = ../bun.nix;
    };
    meta = with lib; {
      description = manifest.meta.description;
      homepage = manifest.meta.homepage;
      license = resolvedLicense;
      mainProgram = manifest.binary.name;
      platforms = platforms.linux ++ platforms.darwin;
      broken = manifest.stubbed || !(builtins.pathExists ../bun.nix);
    };
  };
in
symlinkJoin {
  pname = manifest.binary.name;
  version = packageVersion;
  name = "${manifest.binary.name}-${packageVersion}";
  outputs = [ "out" ] ++ aliasOutputs;
  paths = [ basePackage ];
  nativeBuildInputs = [
    installShellFiles
    makeWrapper
  ];
  postBuild = ''
    rm -rf "$out/bin"
    mkdir -p "$out/bin"
    entrypoint="${basePackage}/share/${manifest.package.repo}/${manifest.binary.entrypoint}"
    if [ ! -f "$entrypoint" ]; then
      echo "missing trellis entrypoint: $entrypoint" >&2
      exit 1
    fi
    mkdir -p "$out/share/${manifest.binary.name}/skill"
    cp ${../skill/SKILL.md} "$out/share/${manifest.binary.name}/skill/SKILL.md"
    cat > "$out/bin/${manifest.binary.name}" <<EOF
#!${lib.getExe bash}
if [ "\$1" = "skill" ]; then
  cat "$out/share/${manifest.binary.name}/skill/SKILL.md"
  exit 0
fi
exec ${lib.getExe' bun "bun"} "$entrypoint" "\$@"
EOF
    chmod +x "$out/bin/${manifest.binary.name}"
    ${aliasOutputLinks}
    bashCompletion="$TMPDIR/${manifest.binary.name}.bash"
    fishCompletion="$TMPDIR/${manifest.binary.name}.fish"
    zshCompletion="$TMPDIR/_${manifest.binary.name}"
    "$out/bin/${manifest.binary.name}" completions bash > "$bashCompletion"
    "$out/bin/${manifest.binary.name}" completions fish > "$fishCompletion"
    "$out/bin/${manifest.binary.name}" completions zsh > "$zshCompletion"
    installShellCompletion --cmd ${manifest.binary.name} \
      --bash "$bashCompletion" \
      --fish "$fishCompletion" \
      --zsh "$zshCompletion"
  '';
  meta = basePackage.meta;
}
