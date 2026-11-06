# Publish a reviewed Pi package

Use this procedure to verify a local release candidate and, only with separate publication authorization, publish the reviewed tarball. The provisional name is `@kyn0v/pi-tele`. It is not published yet. Do not treat package-name availability as proof that you control the npm scope.

## Verify the checkout and packed consumer

1. Use a POSIX host, Node.js 22.19 or newer, npm, and the pinned development Pi host. Package verification requires POSIX process groups and rejects Windows before starting commands. In a fresh checkout without `dist`, run:

   ```sh
   npm ci
   npm run verify:extension
   npm test
   npm run build
   npx playwright install chromium --only-shell
   npm run verify:package
   npm run verify:chat:probe
   npm run verify:browser
   ```

2. Confirm that `verify:package` reports `ok: true` and `modelRuns: 0`. The script runs `npm pack` with `prepack` enabled and checks the actual tar entries and metadata. Its negative controls reject leaked private state and a missing extension entrypoint.
3. Review the report's consumer checks. The tarball installs outside the repository with `--omit=dev --ignore-scripts --legacy-peer-deps`. Only Tele and Zod are physically installed. The development Pi host registers that installed directory through real `pi install`, then loads it in offline RPC without `-e`.
4. Confirm browser pairing, anonymous private-chat rejection, installed CLI writes, stale-revision rejection, and every shipped browser asset. The script removes and reinstalls the consumer's `node_modules`, then checks board content, revision, and capability persistence in the temporary home's `.tele` directory.

The verifier uses temporary HOME, USERPROFILE, Pi settings, npm cache, data, and ports. It sends slash commands, not model prompts. It does not publish or alter your Pi configuration. Its temporary tarball is removed after verification. This proves an npm-installed tarball with Pi local registration, not Pi's npm downloader or registry ownership. The separate browser and chat suites cover behavior beyond package acceptance.

## Pack a release candidate

1. Confirm the npm scope owner and the account's publishing rights through npm's account and organization controls. An `npm view` E404 is not ownership evidence. If the approved package name changes, update the manifest, lockfile, verifier, and both READMEs before repeating verification.
2. Review the version, repository URL, MIT license, third-party notices, `pi.extensions`, and `pi-package` keyword in `package.json`.
3. Run `npm pack --json` from the reviewed checkout. `prepack` runs the existing build and creates a prebuilt tarball. No consumer `prepare` or install hook is needed.
4. Inspect the generated tarball with `tar -tzf <tarball.tgz>`. Review `docs/` and `examples/` as well as runtime files. There must be no `.data`, `.tele`, `.pi`, `.audit`, source tree, credentials, sessions, or `node_modules`.
5. Keep the candidate tarball and its npm integrity report together. If any file changes after review, pack and review again. Do not run `npm publish` against the working directory in place of the reviewed tarball.

The manifest has no executable `bin`. The installed standalone entries are `dist/main.js` and `dist/cli.js`; Pi loads `dist/pi-extension.js`. Pi and TypeBox remain host peers, and Zod is the runtime dependency. Git checkouts require `npm ci` and `npm run build`. Do not advertise a direct Git install as build-free.

## Publish only after authorization

1. Obtain explicit authorization for the reviewed name, version, and tarball. Local preparation is not publication authorization.
2. Publish that tarball with `npm publish <reviewed-tarball.tgz> --access public`.
3. In a disposable Pi profile, install the released version with `pi install npm:@kyn0v/pi-tele@<version>`. Reload Pi and run `/tele harmony`. This is the separate registry and Pi-downloader check that local acceptance does not cover.

The `pi-package` keyword makes a published npm package eligible for the [Pi package gallery](https://pi.dev/packages). Eligibility does not guarantee inclusion or indexing time. No gallery submission, npm publication, push, or pull request is part of the local verification procedure.
