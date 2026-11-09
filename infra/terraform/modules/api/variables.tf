variable "name" {
  type = string
}

variable "region" {
  type = string
}

variable "source_dir" {
  type        = string
  description = "Folder with the Python API package (services/api)."
}

variable "table_arn" {
  type = string
}

variable "table_name" {
  type = string
}

variable "kms_key_arn" {
  type = string
}

variable "media_bucket" {
  type = object({ id = string, arn = string })
}

variable "models_bucket" {
  type = object({ id = string, arn = string })
}

variable "user_pool_id" {
  type = string
}

variable "web_client_id" {
  type = string
}

variable "vision_image_uri" {
  type        = string
  default     = ""
  description = "Photo function image, pinned by digest. Empty skips the photo function (first deploy)."
}

variable "bedrock_invoke_arn" {
  type    = string
  default = ""
}

variable "bedrock_model_id" {
  type    = string
  default = ""
}

variable "bedrock_region" {
  type    = string
  default = ""
}

variable "bedrock_daily_limit" {
  type    = number
  default = 50
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "throttle_rate" {
  type        = number
  default     = 20
  description = "Sustained requests per second the whole API accepts; the rest get 429. Protects the bill from abuse."
}

variable "throttle_burst" {
  type    = number
  default = 40
}

variable "warm_vision" {
  type        = bool
  default     = true
  description = "Ping the photo function every 5 minutes during working hours so scans are not slowed by a cold start."
}
