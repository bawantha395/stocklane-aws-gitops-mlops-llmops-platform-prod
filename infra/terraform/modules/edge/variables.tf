variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "route53_zone_id" {
  type        = string
  description = "Existing public hosted zone that owns web_domain."
}

variable "web_domain" {
  type        = string
  description = "Hostname of the app, for example stocklane.example.com. The API is served under /api on the same name."
}

variable "web_bucket" {
  type = object({ id = string, arn = string, regional_domain_name = string })
}

variable "api_endpoint" {
  type        = string
  description = "HTTP API hostname without https://."
}
