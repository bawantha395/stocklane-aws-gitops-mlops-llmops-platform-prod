# Inputs come from two places:
#   terraform.tfvars           protection settings for prod (committed)
#   pipeline.auto.tfvars.json  your values from the TFVARS_JSON GitHub secret plus the project
#                              name and region, written at run time and never committed

variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "name" {
  type        = string
  description = "Resource name prefix, for example stocklane-prod."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,25}$", var.name))
    error_message = "Use 3-26 lowercase letters, digits and hyphens."
  }
}

variable "route53_zone_id" {
  type        = string
  description = "Existing public hosted zone that owns web_domain."
}

variable "web_domain" {
  type        = string
  description = "The app's hostname, for example stocklane.example.com. The API lives under /api on the same name."
}

variable "owner_email" {
  type        = string
  description = "First owner account: Cognito emails an invitation here."
}

variable "alert_email" {
  type        = string
  description = "Receives budget warnings and alarms."
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "deletion_protection" {
  type        = bool
  default     = true
  description = "true keeps data safe: the table, user pool and buckets refuse to be deleted. false lets Destroy remove everything."
}

variable "vision_image_uri" {
  type        = string
  default     = ""
  description = "Photo function image pinned by digest; the Deploy workflow fills this in after building it."
}

variable "bedrock_model_id" {
  type        = string
  default     = ""
  description = "Foundation model for AI label suggestions, for example amazon.nova-lite-v1:0. Empty turns them off."
}

variable "bedrock_region" {
  type    = string
  default = ""
}

variable "enable_cloudtrail" {
  type    = bool
  default = true
}

variable "warm_vision" {
  type    = bool
  default = true
}

variable "gemini_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Free Google AI Studio key, used only when Bedrock cannot answer. Empty switches the backup off."
}

variable "gemini_model" {
  type    = string
  default = "gemini-3.8-flash,gemini-3.8-flash-lite"
}
