variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "alert_email" {
  type        = string
  description = "Receives budget warnings and alarms."
}

variable "monthly_budget_usd" {
  type    = number
  default = 5
}

variable "function_names" {
  type        = list(string)
  description = "Lambda functions that get an error alarm."
}

variable "api_id" {
  type = string
}

variable "force_destroy" {
  type    = bool
  default = false
}

variable "enable_cloudtrail" {
  type        = bool
  default     = true
  description = "Management-event audit log (the first trail in an account is free; the log files cost cents)."
}
