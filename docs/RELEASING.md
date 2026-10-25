# Releasing Ribbon

## Branches

- **`main`** is development. Everything lands here first. Its version is `X.Y.0-dev.N` (for example `0.2.0-dev.1`).
- **`release/X.Y`** (for example `release/0.2`) is cut from `main` when a version is ready to be tried by real users. Only fixes go there afterwards.
- **`:dev` image.** Every push to `main` publishes `ghcr.io/thepizzatech/ribbon:dev` (and `:sha-<short>`) via `.github/workflows/publish-dev.yml`; no tag is needed.
- **Tags** `vX.Y.Z[-pre.N]` mark releases and are what publish them. Tags are only created on a `release/*` branch.

## Versions

[Semantic Versioning](https://semver.org/): `0.2.0-beta.1`, then `0.2.0-beta.2`, `0.2.0-rc.1`, `0.2.0`, then fixes `0.2.1`. While we are on `0.x`, a minor bump may include breaking changes; the [CHANGELOG](../CHANGELOG.md) says so under "Breaking".

The version lives in `package.json`. The build bakes it in and shows it in Settings → About, the sidebar and `/api/health`. The commit SHA is added by the `GIT_COMMIT` build arg.

## Cutting a release (first beta of 0.2 as the example)

1. On `main`, make sure CI is green and [CHANGELOG.md](../CHANGELOG.md) has everything that is going out.
2. Create the branch:

   ```bash
   git switch main && git pull
   git switch -c release/0.2
   ```

3. On the branch, set the version and finish the changelog:
   - `npm version 0.2.0-beta.1 --no-git-tag-version`
   - In `CHANGELOG.md`, turn the top section into `## [0.2.0-beta.1] - YYYY-MM-DD` (move anything under `[Unreleased]` into it) and add a fresh empty `## [Unreleased]`.
   - Commit: `git commit -am "Release 0.2.0-beta.1"` and `git push -u origin release/0.2`.
4. Tag and push the tag (the tag must equal `v` + the version in `package.json`, or the workflow refuses to publish):

   ```bash
   git tag -a v0.2.0-beta.1 -m "Ribbon 0.2.0-beta.1"
   git push origin v0.2.0-beta.1
   ```

5. The **Release** workflow (`.github/workflows/release.yml`) then:
   - runs typecheck, tests and the build,
   - builds the Docker image for `linux/amd64` and `linux/arm64`,
   - pushes it to `ghcr.io/thepizzatech/ribbon` as `0.2.0-beta.1` (and, for non-pre-releases only, `0.2` and `latest`),
   - creates a GitHub Release with the matching CHANGELOG section, marked as a pre-release when the version has a `-`.
6. Back on `main`, bump to the next development version (`npm version 0.3.0-dev.1 --no-git-tag-version`), and copy the released CHANGELOG section across so `main` has the history.
7. First publish only: in GitHub → Packages → `ribbon` → Package settings, set the visibility you want (public lets others pull without logging in).

## Hotfixes

1. Fix on `release/0.2` (or fix on `main` and cherry-pick: `git cherry-pick -x <sha>`). Keep fixes small.
2. Bump the version (`npm version 0.2.1 --no-git-tag-version`), update the CHANGELOG, commit.
3. Tag `v0.2.1` and push the tag. Same workflow, same outputs.
4. Make sure the fix is also on `main`.

## Running a published image

```bash
RIBBON_TAG=0.2.0-beta.1 docker compose pull
RIBBON_TAG=0.2.0-beta.1 docker compose up -d
```

## Not done yet

- No release branch or tags exist. The first ones are created following this document.
- The multi-arch image build has not been run yet; the first tag will be its first real test.
