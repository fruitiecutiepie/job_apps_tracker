# Cloudflare account resources

OpenTofu config for the Cloudflare resources the tracker owns at account level. Today that
is one: the R2 bucket feedback reports go into. The Worker, its binding to that bucket and
its route are in `/wrangler.jsonc`, not here.

| Resource | Managed by |
|---|---|
| R2 bucket `job-apps-tracker-feedback` (`prevent_destroy`) | `r2.tf` |
| Worker, R2 binding, route, assets | `/wrangler.jsonc` |
| Worker secret `FEEDBACK_ADMIN_TOKEN` | Bitwarden, `scripts/push-worker-secrets` |
| Deploys | `/.github/workflows/deploy.yml` |

Deliberately not managed in code:

- **The zone `fruitiecutiepie.com`, its DNS, rules and settings.** They belong to the
  website repo's state. Two states owning one resource undo each other on every apply,
  so nothing zone-level goes here; the tracker reaches the zone only through the route
  in `wrangler.jsonc`.
- **The API tokens**, the same as on the website.
- **The GitHub `production` environment and its secret.** `scripts/push-github-secrets`
  sets them up.

## Changing config

```sh
git pull                      # the state file is committed
scripts/tofu plan             # stop if it shows changes you didn't make
scripts/tofu apply
git add infra/cloudflare/terraform.tfstate && git commit
```

Don't apply from two machines at once: the committed state doesn't lock, so the second
apply would overwrite the first one's state.

`terraform.tfstate` is encrypted with `job_apps_tracker/TOFU_STATE_PASSPHRASE`. This
repository is public, so the encrypted state is public too, and the passphrase is all that
protects it. Make it long and random: at least 32 characters, generated, never reused.
Without the passphrase the state can't be read. Cloudflare is unaffected, but the bucket
would have to be imported again. Don't change the passphrase in Bitwarden on its own:
rotating it needs the old one configured as a fallback for one apply.

## Secrets

Secrets live in Bitwarden, read with the `bw` CLI (`brew install bitwarden-cli`, then
`bw login` once). Each is a Login item whose password is the value, under this repo's own
prefix so none is shared with the website:

| Item name | Used by |
|---|---|
| `job_apps_tracker/CLOUDFLARE_API_TOKEN` | `scripts/tofu` |
| `job_apps_tracker/TOFU_STATE_PASSPHRASE` | `scripts/tofu` |
| `job_apps_tracker/CLOUDFLARE_DEPLOY_API_TOKEN` | `scripts/push-github-secrets`, which hands it to `deploy.yml` |
| `job_apps_tracker/FEEDBACK_ADMIN_TOKEN` | `scripts/push-worker-secrets` |

The scripts prompt for the master password when the vault is locked. To unlock once for a
terminal session instead:

```sh
source scripts/bw-unlock   # later: bw lock
```

**Rotating the inbox token:** update the item, then run `scripts/push-worker-secrets`. It
changes production at once and runs on your own `pnpm wrangler login`, since the deploy
token can only deploy. Cloudflare refuses it while the newest version isn't the live one,
which a deploy only leaves behind when it fails halfway; rerun `deploy.yml` first.

**Rotating the deploy token:** create the new one, update the item, run
`scripts/push-github-secrets`, then delete the old token.

## Setup

Two tokens, each with only what its holder needs. Create them at
dash.cloudflare.com/profile/api-tokens:

- **`CLOUDFLARE_API_TOKEN`** (for Tofu, on your machine):
  Account → Workers R2 Storage: Edit.
- **`CLOUDFLARE_DEPLOY_API_TOKEN`** (for GitHub): Account → Workers Scripts: Edit;
  Zone (fruitiecutiepie.com) → Workers Routes: Edit and Zone: Read. It cannot touch the
  bucket, the zone's DNS, or anything else of the website's.

Then save both, plus a generated `TOFU_STATE_PASSPHRASE` and the `FEEDBACK_ADMIN_TOKEN`
already set on the Worker, and from the repo root:

```sh
scripts/tofu init
scripts/tofu plan     # expect: 1 to import, 0 to add, 0 to change, 0 to destroy
scripts/tofu apply
git add infra/cloudflare/terraform.tfstate && git commit
```

The bucket was created by hand before this config existed, so `r2.tf` carries an `import`
block. After the first apply, delete that block and check that `scripts/tofu plan` reports
no changes.

```sh
scripts/push-github-secrets   # creates the production environment and its token
```

## Deploys

`.github/workflows/deploy.yml` deploys the Worker whenever the **Test** workflow passes on a
push to `master`, building the commit Test checked. Nothing else needs doing to go live. A
deploy that fails leaves the previous version serving. Rerun it from the Actions tab.

`pnpm deploy` still deploys from a laptop. It skips the test gate and ships whatever is
checked out, so keep it for emergencies.
