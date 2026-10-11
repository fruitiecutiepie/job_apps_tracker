locals {
  account_id = "7828891633435b5779e79eb47ae80873"
}

variable "state_passphrase" {
  description = "Encrypts terraform.tfstate. scripts/tofu reads it from Bitwarden."
  type        = string
  sensitive   = true
}
