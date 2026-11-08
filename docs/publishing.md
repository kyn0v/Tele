# Publish a reviewed DSH and Pi package

Tele uses the npm package name `@kyn0v/pi-tele` and is listed in the [Pi package gallery](https://pi.dev/packages/@kyn0v/pi-tele). Version 0.2.0 adds DSH support while keeping Pi support. This guide covers candidate verification and GitHub Actions releases.

Treat v0.2.0 as a release candidate until its release checks pass and registry publication is confirmed. Public release authorization does not mean that publication or the release CI has completed. Confirm the exact version's registry integrity after publishing. npm publication does not automatically list Tele in the DSH official market.

Version 0.1.0 was published manually and has no OIDC provenance claim. Its packed README contains outdated installation text. Published package bytes cannot be replaced; documentation fixes require a new version.

## Verify a candidate locally

Use a POSIX host, Node.js 22.19 or newer, npm, and the development dependencies in the lockfile. Start from a fresh checkout without `dist`.

```sh
npm ci
npm run verify:ci
```

The shared command runs source extension discovery, tests, build, Playwright Chromium installation, packed-consumer verification, the no-model chat probe, and browser verification in that order. It fails if `dist` already exists and does not delete build output. Never substitute the optional, paid `verify:chat:browser` for the no-model probe in CI.

GitHub-hosted Ubuntu installs Chromium's OS dependencies with Playwright `--with-deps`. Local runs do not invoke sudo. On other Linux hosts, install the [Playwright system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies) separately if needed. The command uses an absolute `PLAYWRIGHT_BROWSERS_PATH`, defaulting to `tele-playwright` under the system temporary directory. An explicit path must also be absolute. Package verification forwards that path into its isolated environment, without copying credentials from your environment.

To retain the exact tested tarball, choose an absolute output directory that does not exist and whose parent exists.

```sh
npm run verify:ci -- --artifact-dir /absolute/path/release-artifact
```

The directory appears only after the entire gate succeeds and owned subprocesses close. It contains only the original tested tarball and `metadata.json`, with the filename, package name, stable version, git commit, and SHA-512 integrity of the actual bytes. There is no second pack operation for export. A failed gate or export fails the command and does not expose a successful artifact. A local dirty checkout can be tested, but its commit field does not prove that the edits are committed. Release jobs use an immutable, fresh checkout.

`verify:package` also accepts `--artifact-dir` to retain its exact tarball after its own successful checks and cleanup. That narrower command does not prove the subsequent chat and browser suites passed. Without this option, temporary tarballs are removed as before.

Packed-consumer verification installs production dependencies with lifecycle scripts disabled and host peers omitted. It checks the DSH entrypoint, bundle patch, locales, icon, and manifest declarations in the actual tarball. A structural test context loads the packed DSH entrypoint with only production dependencies. It checks board writes, production assets, disabled chat, and cleanup. This portability smoke test does not run the real DSH tool registry or inspect the Plugin Manager UI.

The development Pi host registers the installed directory in a disposable offline profile. It checks extension loading, private browser pairing, all shipped assets, CLI conflicts, default home storage, and persistence after reinstall. This local test does not exercise Pi's npm downloader. Check that the report says `ok: true` and `modelRuns: 0`.

## Verify the DSH candidate on a real host

Use DSH `0.2.2-rc.1`. Install the reviewed local source directory through the Plugin Manager, then follow the [DSH acceptance checklist](dsh.md#verification-status-and-checklist). Record activation, catalogue and board calls, revision conflicts, SSE updates, stop cleanup, and persistence after reactivation. Check that other DSH tools remain available.

Use the URL returned by a real `tele_board` call for `npm run verify:dsh:live -- <url>`. That read-only browser test does not create or update boards or prove the DSH tool pipeline. It also does not verify the Plugin Manager's displayed title, description, or icon. Check those in the actual GUI. Keep unavailable GUI checks and subjective listening separate from passed checks.

Run these checks for the reviewed release candidate. Earlier local acceptance is useful evidence, but it does not replace CI or acceptance of the final version and artifact.

## Configure the owner-controlled release gate

Maintainers configure these settings before publishing. Adding workflow files does not enable npm trust or create a release.

1. Merge the reviewed workflow changes into the public `kyn0v/Tele` repository and confirm that GitHub Ubuntu CI passes. Local tests do not replace this check.
2. Create the GitHub environment named exactly `npm`. Configure required owner approval and a protected release-tag policy. Restrict who can create or move release tags through repository rules. The workflow does not configure or guarantee those protections. Confirm the environment's current protection rules in GitHub before releasing.
3. In the npm package's **Settings**, add a GitHub Actions **Trusted Publisher** with these case-sensitive fields:
   - **Organization or user** is `kyn0v`.
   - **Repository** is `Tele`.
   - **Workflow filename** is `publish.yml`, not `.github/workflows/publish.yml`.
   - **Environment name** is `npm`.
   - Under **Allowed actions**, enable direct publishing with `npm publish`. New configurations otherwise allow only `npm stage publish`. This workflow does not use staged publishing or need dist-tag management permission.
4. Create trust only when ready for the next authorized release. npm requires its first successful trusted publish within two days of creating the configuration. An expired configuration must be deleted and recreated by its owner.

See the [official npm trusted publisher instructions](https://docs.npmjs.com/trusted-publishers/) for the current settings. Use GitHub-hosted runners, Node.js 24, and npm CLI 11.5.1 or newer. The workflows install npm 11 if the bundled CLI is older. No npm secret token or `NODE_AUTH_TOKEN` is required. `npm whoami` does not test OIDC trust. A no-op for an already published version does not validate a new trust configuration.

For future public OIDC publications from this public repository, npm automatically generates provenance. That does not retroactively add provenance to the manual 0.1.0 release. Changes to package access or account settings remain a separate owner decision.

## Release the next authorized version

1. Review the intended version and update both `package.json` and `package-lock.json`. Keep the lockfile root package version in agreement. Merge the reviewed version bump into `main` and wait for CI. There is no automatic version bump or automatic release from a push to main.
2. With publication authorization, create a canonical stable `vX.Y.Z` tag at that reviewed main commit and publish a stable GitHub release for it. Drafts, prereleases, other repositories, noncanonical tags, version mismatches, and commits outside main ancestry fail preflight. There is no manual workflow-dispatch bypass.
3. Review the read-only verification job. Preflight reads the event as JSON using trusted main code, resolves the tag to an immutable commit, and checks its ancestry before any tagged code runs. Verification checks out that SHA and runs the same `verify:ci` gate as pull requests and main pushes. Only a successful gate uploads its checked artifact.
4. Approve the `npm` environment deployment after reviewing the release and artifact. Only the dependent publish job has `id-token: write`. It downloads the artifact from that same workflow run and runs a builtins-only helper from the verified SHA. It performs no `npm ci`, project dependency install, build, pack, or package lifecycle hook.
5. Confirm the job's registry integrity result. It checks metadata, release version and commit, SHA-512 bytes, and the tar manifest before using `npm publish <tarball> --access public --ignore-scripts --registry=https://registry.npmjs.org/`. Only a parsed HTTP 404 from the exact version endpoint allows a new publish. Auth, transport, malformed responses, and server failures do not count as absence.
6. In DSH `0.2.2-rc.1`, install `@kyn0v/pi-tele@<version>` through the Plugin Manager. The agent equivalent is `plugin_manager` with `action: install_bundle` and the same spec as `target`. Check actual activation and board operations. The published package includes built files and needs no source build or installation scripts.
7. In a disposable Pi profile, install `pi install npm:@kyn0v/pi-tele@<version>`, reload Pi, and run `/tele harmony`. Check the browser, CLI, persisted boards, and gallery version independently of packed-consumer acceptance.
8. Treat any DSH official-market listing as a separate publication step. npm availability alone does not prove that listing exists.

An existing exact version is a no-op only when registry integrity matches the checked tarball. A mismatch fails. npm can exit successfully before the exact version endpoint returns the package. The 0.1.1 release remained absent through five confirmation reads over about eight seconds, then appeared with matching artifact integrity and GitHub Actions provenance. Do not republish 0.1.1.

After one publish attempt, the helper waits up to five minutes for matching registry integrity, with five-second intervals between reads. Each request has a 15-second deadline, shortened to the remaining confirmation time. Retry sleeps also stop at that deadline. The publish command has a two-minute deadline, and the publish job has a ten-minute cap. The helper preserves successful npm output, including processing and provenance notices.

If npm succeeds but confirmation expires, the helper reports that registry confirmation is still pending. It never repeats `npm publish`, even after an uncertain command result. Inspect the exact version's registry integrity before deciding whether to rerun a failed workflow. A later rerun skips publication only if the existing version matches that run's checked artifact. Do not assume a rebuilt tarball has identical bytes.

Release concurrency prevents simultaneous release runs and does not cancel the active run. GitHub concurrency does not guarantee a FIFO queue and can replace a pending run. If several releases are created together, the owner must check that each intended release ran.

The workflows never push, merge, create tags or releases, or alter account settings. The manifest has no executable `bin`. DSH loads `dist/dsh-extension.js` through the package root or `./dsh` export and the bundle patch. Pi retains `pi.extensions` and the `./pi` export for `dist/pi-extension.js`. Standalone entries remain `dist/main.js` and `dist/cli.js`. Pi and TypeBox are optional host peers, so a DSH-only installation does not need to install Pi. Zod remains the runtime dependency. Git checkouts still require dependencies and a build. Published packages include the build output.
