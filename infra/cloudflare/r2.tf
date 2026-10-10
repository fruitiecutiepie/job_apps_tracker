# Feedback reports and their screenshots (binding FEEDBACK in /wrangler.jsonc). It holds
# what readers sent, which nothing else has a copy of.
resource "cloudflare_r2_bucket" "feedback" {
  account_id    = local.account_id
  name          = "job-apps-tracker-feedback"
  location      = "oc"
  jurisdiction  = "default"
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

# Created by hand with wrangler on 2026-10-08, before this config existed. Delete this
# block once the import has been applied and the state committed.
import {
  to = cloudflare_r2_bucket.feedback
  id = "${local.account_id}/job-apps-tracker-feedback/default"
}
