const sourceRepo = "https://github.com/RogerNavelsaker/trellis.git";
const manifestPath = "nix/package-manifest.json";
const packageJsonPath = "package.json";
const packageNixPath = "nix/package.nix";
const bunLockPath = "bun.lock";
const bunNixPath = "bun.nix";

type SyncMode = "source" | "release";

async function run(command: string[], cwd?: string) {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with ${exitCode}\n${stderr}`);
  }
  return stdout.trim();
}

function parseVersion(tag: string) {
  const normalized = tag.startsWith("v") ? tag.slice(1) : tag;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }
  return {
    raw: tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

async function resolveLatestTag() {
  const tagRefs = await run(["git", "ls-remote", "--tags", "--refs", sourceRepo]);
  return tagRefs
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1]?.replace("refs/tags/", ""))
    .filter(Boolean)
    .map(parseVersion)
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => compareVersions(b, a))[0]?.raw;
}

async function cloneSource(tempDir: string, mode: SyncMode) {
  if (mode === "source") {
    await run(["git", "clone", "--depth", "1", sourceRepo, tempDir]);
    return { sourceTag: null as string | null };
  }

  const latestTag = await resolveLatestTag();
  if (!latestTag) {
    throw new Error(
      "github-release sync requires at least one upstream tag. Use `bun run sync:github-source` if you want branch-head sync.",
    );
  }

  await run(["git", "clone", "--depth", "1", "--branch", latestTag, sourceRepo, tempDir]);
  return { sourceTag: latestTag };
}

export async function syncFromGitHub(mode: SyncMode) {
  const manifest = await Bun.file(manifestPath).json();
  const packageJson = await Bun.file(packageJsonPath).json();
  const tempDir = await run(["mktemp", "-d", `${Bun.env.TMPDIR ?? "/tmp"}/trellis-sync-XXXXXX`]);

  try {
    const { sourceTag } = await cloneSource(tempDir, mode);
    const sourcePackageJson = await Bun.file(`${tempDir}/package.json`).json();
    const sourceRev = await run(["git", "rev-parse", "HEAD"], tempDir);

    await Bun.write(bunLockPath, await Bun.file(`${tempDir}/bun.lock`).text());
    await run(["bun", "x", "bun2nix", "--lock-file", bunLockPath, "--output-file", bunNixPath]);

    const prefetchHash = await run([
      "nix-prefetch-url",
      "--unpack",
      `https://github.com/RogerNavelsaker/trellis/archive/${sourceRev}.tar.gz`,
    ]);
    const hash = await run([
      "nix",
      "hash",
      "to-sri",
      "--type",
      "sha256",
      prefetchHash.split("\n")[0],
    ]);

    manifest.stubbed = false;
    manifest.package.version = sourcePackageJson.version;
    manifest.package.sourceRev = sourceRev;
    manifest.meta.description = sourcePackageJson.description ?? manifest.meta.description;
    manifest.meta.homepage = sourcePackageJson.homepage ?? manifest.meta.homepage;
    manifest.meta.licenseSpdx = sourcePackageJson.license ?? manifest.meta.licenseSpdx;

    packageJson.version = sourcePackageJson.version;
    packageJson.description = sourcePackageJson.description;
    packageJson.license = sourcePackageJson.license;
    packageJson.repository = sourcePackageJson.repository;
    packageJson.homepage = sourcePackageJson.homepage;
    packageJson.bugs = sourcePackageJson.bugs;
    packageJson.keywords = sourcePackageJson.keywords;
    packageJson.bin = sourcePackageJson.bin;
    packageJson.engines = sourcePackageJson.engines;
    packageJson.dependencies = sourcePackageJson.dependencies;
    packageJson.devDependencies = {
      ...sourcePackageJson.devDependencies,
      bun2nix: packageJson.devDependencies?.bun2nix ?? "2.0.8",
    };

    const packageNix = await Bun.file(packageNixPath).text();
    const updatedPackageNix = packageNix
      .replace(/rev = "[a-f0-9]+"/, `rev = "${sourceRev}"`)
      .replace(/hash = "sha256-[^"]+"/, `hash = "${hash}"`);

    await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await Bun.write(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    await Bun.write(packageNixPath, updatedPackageNix);

    console.log(
      JSON.stringify(
        {
          mode,
          version: manifest.package.version,
          sourceTag,
          sourceRev,
          hash,
        },
        null,
        2,
      ),
    );
  } finally {
    await run(["rm", "-rf", tempDir]);
  }
}
