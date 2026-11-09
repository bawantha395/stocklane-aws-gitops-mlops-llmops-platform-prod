variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "force_destroy" {
  type        = bool
  default     = false
  description = "true lets Destroy delete non-empty buckets and the table. Keep false for prod data."
}
