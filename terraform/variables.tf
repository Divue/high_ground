# Values come from the repo's .env and data/admin_token through terraform/deploy.sh (TF_VAR_*).
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "aws_profile" {
  type    = string
  default = "default"
}

variable "project" {
  type    = string
  default = "highground"
}

variable "bedrock_model_id" {
  description = "Bedrock model or inference profile used by the assistant and the alert writer. Bedrock is refused on this account until AWS Support verifies it; alerts fall back to their template text meanwhile."
  type        = string
  default     = "us.anthropic.claude-sonnet-5-5"
}

variable "admin_token" {
  description = "Shared secret for POST /admin/run (the demo's Run now button)."
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Inbox for the budget alarm. Empty: the budget has no notification."
  type        = string
  default     = ""
}

variable "strands_layer_key" {
  description = "Key of the Strands Agents SDK layer zip in the artifacts bucket (deploy.sh uploads it: ~40 MB is too slow and lossy to push through Terraform on this link)."
  type        = string
}

variable "enable_address_search" {
  description = "Route POST /geocode to the Amazon Location Lambda. Off: the site searches only its own list of places and streets, exactly as the local build does. With the site's code as it stands, turning this on lists Amazon's addresses above the app's own streets, and a picked street can answer for the wrong stretch."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  type    = number
  default = 14
}
